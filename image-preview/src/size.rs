use std::io::Read;
use std::path::Path;

pub fn of(path: &Path) -> Option<(u32, u32)> {
    let mut head = Vec::with_capacity(64 * 1024);
    std::fs::File::open(path).ok()?.take(64 * 1024).read_to_end(&mut head).ok()?;
    parse(&head)
}

fn be16(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?)))
}

fn le16(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?)))
}

fn be32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn le32(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn le24(bytes: &[u8], at: usize) -> Option<u32> {
    let b = bytes.get(at..at + 3)?;
    Some(u32::from(b[0]) | (u32::from(b[1]) << 8) | (u32::from(b[2]) << 16))
}

pub fn parse(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((be32(bytes, 16)?, be32(bytes, 20)?));
    }
    if bytes.starts_with(b"GIF8") {
        return Some((le16(bytes, 6)?, le16(bytes, 8)?));
    }
    if bytes.starts_with(b"BM") {
        let height = le32(bytes, 22)? as i32;
        return Some((le32(bytes, 18)?, height.unsigned_abs()));
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return match bytes.get(12..16)? {
            b"VP8X" => Some((le24(bytes, 24)? + 1, le24(bytes, 27)? + 1)),
            b"VP8L" => {
                let bits = le32(bytes, 21)?;
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8 " => Some((le16(bytes, 26)? & 0x3fff, le16(bytes, 28)? & 0x3fff)),
            _ => None,
        };
    }
    if bytes.starts_with(&[0xff, 0xd8]) {
        let mut at = 2;
        while at + 9 < bytes.len() {
            if bytes[at] != 0xff {
                at += 1;
                continue;
            }
            let marker = bytes[at + 1];
            let length = be16(bytes, at + 2)? as usize;
            if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
                return Some((be16(bytes, at + 7)?, be16(bytes, at + 5)?));
            }
            at += 2 + length;
        }
    }
    None
}

pub fn fit(width: f32, height: f32, max_width: f32, max_height: f32) -> Option<(f32, f32)> {
    if width < 1. || height < 1. {
        return None;
    }
    let scale = (max_width / width).min(max_height / height).min(1.);
    Some(((width * scale).round().max(1.), (height * scale).round().max(1.)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_is_shrunk_to_fit_never_grown() {
        assert_eq!(fit(100., 50., 360., 280.), Some((100., 50.)));
        assert_eq!(fit(1920., 1080., 360., 280.), Some((360., 203.)));
        assert_eq!(fit(500., 2000., 360., 280.), Some((70., 280.)));
        assert_eq!(fit(0., 10., 360., 280.), None);
    }

    #[test]
    fn headers_say_the_size() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend(640u32.to_be_bytes());
        png.extend(480u32.to_be_bytes());
        assert_eq!(parse(&png), Some((640, 480)));
        let gif = [b"GIF89a".as_slice(), &10u16.to_le_bytes(), &20u16.to_le_bytes()].concat();
        assert_eq!(parse(&gif), Some((10, 20)));
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x02, 0x00, 0x03];
        assert_eq!(parse(&jpeg), Some((512, 256)));
        assert_eq!(parse(b"<svg"), None);
    }
}
