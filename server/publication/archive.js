const { crc32 } = require('./mediaTypes');
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
function publicArchive(media, allowed = () => true) {
    const names = Object.keys(media.index().entries).filter(allowed).sort();
    if (names.length > 1024) throw new Error('Archive file count exceeded');
    const local = [], central = []; let offset = 0, total = 0;
    for (const relative of names) {
        const result = media.read(relative);
        if (!result) throw new Error('Published media disappeared');
        total += result.bytes.length;
        if (total > MAX_ARCHIVE_BYTES) throw new Error('Archive size exceeded');
        const name = Buffer.from(relative.slice('assets/'.length), 'utf8'), crc = crc32(result.bytes);
        const header = Buffer.alloc(30), record = Buffer.alloc(46);
        header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
        header.writeUInt16LE(33, 12);
        header.writeUInt32LE(crc, 14); header.writeUInt32LE(result.bytes.length, 18); header.writeUInt32LE(result.bytes.length, 22); header.writeUInt16LE(name.length, 26);
        record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
        record.writeUInt16LE(33, 14);
        record.writeUInt32LE(crc, 16); record.writeUInt32LE(result.bytes.length, 20); record.writeUInt32LE(result.bytes.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
        local.push(header, name, result.bytes); central.push(record, name);
        offset += header.length + name.length + result.bytes.length;
    }
    const directory = Buffer.concat(central), footer = Buffer.alloc(22);
    footer.writeUInt32LE(0x06054b50); footer.writeUInt16LE(names.length, 8); footer.writeUInt16LE(names.length, 10); footer.writeUInt32LE(directory.length, 12); footer.writeUInt32LE(offset, 16);
    return { bytes: Buffer.concat([...local, directory, footer]), names: names.map(name => name.slice('assets/'.length)) };
}
module.exports = { publicArchive, MAX_ARCHIVE_BYTES };
