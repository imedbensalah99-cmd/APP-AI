from pathlib import Path
from urllib.request import urlopen
import hashlib

BASE = "https://huggingface.co/vadimbelsky/arabic-emirati-female-piper/resolve/cfe173969620e40be65b5dd8ed4d97d55a864325/"
TARGET = Path("/opt/omda-voice")
TARGET.mkdir(parents=True, exist_ok=True)
FILES = ("arabic-emirati-female-model.onnx", "arabic-emirati-female-model.onnx.json")
for filename in FILES:
    with urlopen(BASE + filename + "?download=true", timeout=120) as response, (TARGET / filename).open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
expected = "1578a9b27d01a0626227225b148179628b770607dd61bdbbc41865bd399106b1"
actual = hashlib.sha256((TARGET / FILES[0]).read_bytes()).hexdigest()
if actual != expected:
    raise SystemExit("Piper Arabic voice model checksum mismatch; aborting build")
print("Verified Arabic voice model checksum")