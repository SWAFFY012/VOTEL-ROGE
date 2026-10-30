Card click and hover: https://www.oneheartisok.com/ public sfxUrls configuration, retrieved 2026-09-20.
click: https://cdn.prod.website-files.com/699b07a23bfec501d96ad2cd/6a085205879a7050ca249ca7_click%2015.mp3
hover: https://cdn.prod.website-files.com/699b07a23bfec501d96ad2cd/6a0e19b1ec7579a8ceef3301_hover%203.mp3
Background and guitar WAV: user-supplied files.

Music (user-supplied WAV masters, 48 kHz):
misery.m4a ← «MIZERY (site version).wav» — main background track.
letov-88.m4a ← «Летов 88.wav» — plays from the first pull of the flower sheet.
sto-let-odinochestva.m4a ← «Сто лет одиночества.wav» — plays over the child cover.
All three made with ffmpeg: high-pass 28 Hz, −2.5 dB at 1.2 kHz, −4.5 dB at
3.2 kHz, high shelf −6 dB from 6.5 kHz, low-pass 15 kHz, then two-pass linear
loudnorm to −20 LUFS / −2 dBTP; AAC 192 kbps (aac_at).

Release page room ambience (user-supplied MP3s), made with ffmpeg at 22.05 kHz:
room-birds.wav ← «morning-meadow-birdsongs-looping».mp3 — birds far off,
  through an open window pane. High-pass 500 Hz, low-pass 3.6 kHz, high shelf
  −9 dB from 1.8 kHz, stereo narrowed to the window (extrastereo 0.3), dry
  0.55 against 0.8 wet convolution with a 2.6 s dark noise tail. Rendered
  over three loops and cut to the middle one, so the reverb wraps and the
  25.2 s loop is seamless. −36 LUFS, 16-bit WAV (no AAC gap).
room-tv.m4a ← «nachalo-i-konec-voskresnoi-peredachi-1965».mp3 from 0:25 — the
  broadcast behind the right wall. Mono, 170–650 Hz band, +3 dB at 380 Hz,
  60 % wet 0.8 s small-room convolution; right channel as is, left channel
  low-passed 420 Hz, −9 dB, 0.7 ms later. 1.5 s fade in, 2.5 s fade out.
  −32 LUFS, AAC 96 kbps.
