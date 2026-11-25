# Build the README scroll GIF from figures.html?fig=pan frames.
# Usage (dev server running): python3 scripts/make-gif.py
import os, subprocess, sys, tempfile
from PIL import Image

CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
BASE = os.environ.get('BASE', 'http://localhost:8791')
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, PER = 480, 220, 12
themes = ['meadow', 'forest', 'desert', 'snow', 'lava']
frames = []
with tempfile.TemporaryDirectory() as tmp:
    for ti, theme in enumerate(themes):
        for f in range(PER):
            g = ti * PER + f
            out = os.path.join(tmp, f'{g:03d}.png')
            subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                            f'--window-size={W},{H}', '--virtual-time-budget=20000', f'--screenshot={out}',
                            f'{BASE}/figures.html?fig=pan&theme={theme}&f={g * 2}&w={W}&h={H}'], check=True, capture_output=True)
            frames.append(Image.open(out).convert('RGB').quantize(colors=96, method=Image.Quantize.MEDIANCUT))
            sys.stdout.write('.'); sys.stdout.flush()
frames[0].save(os.path.join(root, 'assets/readme/scroll.gif'), save_all=True, append_images=frames[1:], duration=70, loop=0, optimize=True)
print('\nscroll.gif', os.path.getsize(os.path.join(root, 'assets/readme/scroll.gif')) // 1024, 'KB')
