// Chép art / âm thanh / font của bản Unity sang game/web/art/ cho màn Chơi thử (game/web/playview.mjs).
//   node game/tools/unity_art.mjs <repo Unity parking-loop>
// Ảnh được thu nhỏ (cạnh dài tối đa `max` px) bằng System.Drawing của Windows PowerShell; âm thanh và font chép nguyên.
// Art trong game đổi thì chạy lại, xem màn Chơi thử rồi commit game/web/art/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../web/art');
const COLORS = ['Red', 'Yellow', 'Turquoise', 'Light Blue', 'Green', 'Brown', 'Lavender', 'Pink', 'Orange', 'Black', 'Purple',
  'Magenta', 'White', 'Cream', 'Blue'];   // thứ tự mã màu 1..15 (format.mjs COLOR_NAMES)

const S = 'Assets/_Game/Art/Sprites/', FX = 'Assets/_Game/Art/Popups/Effects/Textures/';
// [nguồn trong repo Unity, tên ra, cạnh dài tối đa]
const IMAGES = [
  ...COLORS.map((c, i) => [`${S}Sticker_Car_${c}.png`, `car${i + 1}.png`, 160]),
  [`${S}hidden_car_front.png`, 'car_hidden.png', 160],
  [`${S}Splash_White 1.png`, 'splash.png', 96],
  [`${S}lock_0.png`, 'lock.png', 96],
  [`${S}Lock&Key_Obstacle_0.png`, 'lockkey.png', 128],
  [`${S}passive_lock.png`, 'lockbox.png', 96],
  [`${S}car_generator.png`, 'garage.png', 160],
  ['Assets/_Game/Art/Textures/Ice_Diffuse_T.png', 'ice_tex.png', 256],
  ...[1, 2, 3, 4, 5].map(i => [`${S}ice_piece_0${i}.png`, `ice_piece${i}.png`, 64]),
  [`${S}Road_Blocker_07.png`, 'blocker.png', 256],
  [`${S}Platform_Top 1.png`, 'platform.png', 160],
  [`${S}Curtain_Top 1.png`, 'curtain_top.png', 160],
  [`${S}Curtain_Middle 1.png`, 'curtain_mid.png', 160],
  [`${S}Curtain_Under 1.png`, 'curtain_under.png', 160],
  ...[1, 2, 3].map(i => [`${S}curtain_open_0${i}.png`, `curtain_open${i}.png`, 160]),
  [`${S}rope_connected.png`, 'rope.png', 128],
  [`${S}badge.png`, 'badge.png', 64],
  [`${S}Conveyor_Limit_0.png`, 'loop_sign.png', 124],
  [`${S}Conveyor_Limit_Red_0.png`, 'loop_sign_full.png', 124],
  [`${S}Road_Under_Open.png`, 'asphalt.png', 256],
  [`${S}Grass_Left.png`, 'grass_left.png', 320],
  [`${S}Grass_Right.png`, 'grass_right.png', 320],
  ['Assets/_Game/Art/Textures/background.png', 'ground.png', 256],
  [`${S}Tap-Hand.png`, 'tap_hand.png', 96],
  [`${S}gameplay-ui-button-unlocked-blue.png`, 'btn_blue.png', 128],
  [`${S}Notification_Badge_Red.png`, 'badge_red.png', 48],
  [`${S}Extra_Track_limit_booster.png`, 'boost_loop.png', 128],
  [`${S}menu-booster-icon-shuffle.png`, 'boost_shuffle.png', 128],
  [`${S}Hand.png`, 'boost_hand.png', 128],
  [`${S}Booster_Hammer.png`, 'boost_hammer.png', 128],
  [`${FX}Star.png`, 'fx_star.png', 128],
  [`${FX}Glow.png`, 'fx_glow.png', 128],
  [`${FX}spark06.png`, 'fx_spark.png', 64],
  [`${FX}firework.png`, 'fx_firework.png', 128],
  [`${FX}Circle_01.png`, 'fx_smoke.png', 128],
  [`${FX}paper4x4 1.png`, 'fx_confetti.png', 256],
  ['Assets/_Game/Art/Popups/UI/Lose/mascot_fail.png', 'mascot_fail.png', 320],
];
const COPY = [
  ['Assets/_Game/Generated/Audio/sfx_tap.wav', 'sfx_tap.wav'],
  ['Assets/_Game/Audio/CarPick_S3C3.ogg', 'sfx_go.ogg'],
  ['Assets/_Game/Audio/UnselectableCar_1.ogg', 'sfx_bump.ogg'],
  ['Assets/_Game/Audio/UnitToTilePlacementStartSound.ogg', 'sfx_insert.ogg'],
  ['Assets/_Game/Audio/lane-match.ogg', 'sfx_clear.ogg'],
  ['Assets/_Game/Audio/Success Complete.ogg', 'sfx_win.ogg'],
  ['Assets/_Game/Audio/LevelFail.ogg', 'sfx_lose.ogg'],
  ['Assets/_Game/Generated/Audio/sfx_noroom.wav', 'sfx_noroom.wav'],
  ['Assets/_Game/Audio/pop_up_1.ogg', 'sfx_click.ogg'],
  ['Assets/_Game/Fonts/FontNew/ENG/1FTVVIPMikado-Black.otf', 'mikado.otf'],
];

const repo = process.argv[2];
if (!repo || !fs.existsSync(path.join(repo, 'Assets/_Game'))) {
  console.error('Dùng: node game/tools/unity_art.mjs <repo Unity parking-loop>');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
for (const [src, out] of COPY) fs.copyFileSync(path.join(repo, src), path.join(OUT, out));

const ps = `Add-Type -AssemblyName System.Drawing
foreach ($line in Get-Content -LiteralPath $args[0] -Encoding UTF8) {
  $src, $dst, $max = $line.Split([char]9)
  $im = [System.Drawing.Image]::FromFile($src)
  $k = [math]::Min(1.0, [double]$max / [math]::Max($im.Width, $im.Height))
  $w = [math]::Max(1, [int]($im.Width * $k)); $h = [math]::Max(1, [int]($im.Height * $k))
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($im, 0, 0, $w, $h)
  $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $im.Dispose()
}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plart-'));
const list = path.join(tmp, 'list.txt'), script = path.join(tmp, 'resize.ps1');
fs.writeFileSync(list, IMAGES.map(([src, out, max]) => [path.resolve(repo, src), path.join(OUT, out), max].join('\t')).join('\n'), 'utf8');
fs.writeFileSync(script, `﻿${ps}`, 'utf8');
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, list], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
const total = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`${IMAGES.length} ảnh + ${COPY.length} file → ${path.relative(process.cwd(), OUT)} (${(total / 1024).toFixed(0)} KB)`);
