// A Pairing Code as a QR, in characters a text view can draw: the same code Heeler's own plugin
// renders in its popup (`qrcode`'s terminal renderer), but without ANSI colours, so it reads in any
// theme and can also be copied or printed.
//
// Each text row holds two module rows, using the half blocks `▀` and `▄` and the full block `█`, so
// the code is square in a monospaced font at about half the height it would otherwise need.

import QRCode from "qrcode";

/** The quiet zone around the code, in modules: QR's spec asks for 4. */
const QUIET = 4;

/** Whether the code's module at `(x, y)` is dark: `(0, 0)` is the top-left. */
function dark(data: Uint8Array, size: number, x: number, y: number): boolean {
  return data[y * size + x] === 1;
}

/** The code as text rows, top to bottom, quiet zone included. */
export function qrRows(text: string, options: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" } = {}): string[] {
  const qr = QRCode.create(text, { errorCorrectionLevel: options.errorCorrectionLevel ?? "M" });
  const size = qr.modules.size;
  const data = qr.modules.data as Uint8Array;
  const rows: string[] = [];
  const blank = " ".repeat(size + QUIET * 2);
  for (let pad = 0; pad < QUIET; pad += 1) rows.push(blank);
  for (let y = 0; y < size; y += 2) {
    let row = " ".repeat(QUIET);
    for (let x = 0; x < size; x += 1) {
      row += halfBlock(dark(data, size, x, y), y + 1 < size && dark(data, size, x, y + 1));
    }
    rows.push(row + " ".repeat(QUIET));
  }
  for (let pad = 0; pad < QUIET; pad += 1) rows.push(blank);
  return rows;
}

/** Two module rows as one text cell: both dark, the top only, the bottom only, or neither. */
function halfBlock(top: boolean, bottom: boolean): string {
  if (top && bottom) return "█";
  if (top) return "▀";
  if (bottom) return "▄";
  return " ";
}

/** The code as one string, a line per text row: what a text view or a terminal shows. */
export function qrText(text: string, options: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" } = {}): string {
  return qrRows(text, options).join("\n");
}
