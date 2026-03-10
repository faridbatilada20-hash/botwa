const fs = require('fs');
const { tmpdir } = require('os');
const Crypto = require('crypto');
const ff = require('fluent-ffmpeg');
const webp = require('node-webpmux');

async function createExif(packname, author) {
    const img = new webp.Image();
    const json = {
        'sticker-pack-id': `faridbot-${Date.now()}`,
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        'emojis': ['😊']
    };
    
    let exif = Buffer.from(JSON.stringify(json), 'utf-8');
    exif = Buffer.concat([Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]), exif]);
    exif = Buffer.concat([exif, Buffer.alloc(4)]);
    
    img.load(exif);
    return img;
}

async function addExif(webpBuffer, packname, author) {
    const img = new webp.Image();
    const json = {
        'sticker-pack-id': `faridbot-${Date.now()}`,
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        'emojis': ['😊']
    };
    
    let exif = Buffer.from(JSON.stringify(json), 'utf-8');
    exif = Buffer.concat([Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]), exif]);
    exif = Buffer.concat([exif, Buffer.alloc(4)]);
    
    await img.load(webpBuffer);
    img.exif = exif;
    return await img.save(null);
}

module.exports = { createExif, addExif };
