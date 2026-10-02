const assert = require("assert");
const fs = require("fs");
const path = require("path");

const iconPath = path.join(__dirname, "..", "assets", "icon.ico");
const buffer = fs.readFileSync(iconPath);

assert(buffer.length >= 4096, "Windows icon is unexpectedly small.");
assert(buffer.length >= 6, "Windows icon header is missing.");

const reserved = buffer.readUInt16LE(0);
const type = buffer.readUInt16LE(2);
const count = buffer.readUInt16LE(4);

assert.strictEqual(reserved, 0, "ICO reserved field must be zero.");
assert.strictEqual(type, 1, "File must be a Windows ICO resource.");
assert(count >= 4 && count <= 32, "ICO should contain multiple image sizes.");

const dimensions = [];
const entriesEnd = 6 + count * 16;
assert(entriesEnd <= buffer.length, "ICO directory is truncated.");

for (let index = 0; index < count; index++) {
  const offset = 6 + index * 16;
  const widthByte = buffer[offset];
  const heightByte = buffer[offset + 1];
  const width = widthByte === 0 ? 256 : widthByte;
  const height = heightByte === 0 ? 256 : heightByte;
  const planes = buffer.readUInt16LE(offset + 4);
  const bitCount = buffer.readUInt16LE(offset + 6);
  const size = buffer.readUInt32LE(offset + 8);
  const imageOffset = buffer.readUInt32LE(offset + 12);

  assert(width === height, "ICO image must be square.");
  assert(planes === 1, "ICO image must use one color plane.");
  assert(bitCount === 32, "ICO images must be 32-bit.");
  assert(size > 40, "ICO image data is too small.");
  assert(imageOffset >= entriesEnd, "ICO image overlaps its directory.");
  assert(imageOffset + size <= buffer.length, "ICO image data is truncated.");

  const dibHeaderSize = buffer.readUInt32LE(imageOffset);
  assert.strictEqual(dibHeaderSize, 40, "ICO entry must contain a BITMAPINFOHEADER.");

  const dibWidth = buffer.readInt32LE(imageOffset + 4);
  const dibHeight = buffer.readInt32LE(imageOffset + 8);
  assert.strictEqual(dibWidth, width, "ICO directory width does not match DIB width.");
  assert.strictEqual(dibHeight, height * 2, "ICO DIB height must include XOR and AND masks.");

  dimensions.push(width);
}

for (const required of [16, 32, 48, 64, 128, 256]) {
  assert(dimensions.includes(required), "ICO is missing required size " + required + "x" + required + ".");
}

console.log("Release asset tests passed:", dimensions.join(", "));
