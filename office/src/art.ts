// The office's sprites: the SVGs in the theme's `images/`, drawn at one unit per pixel and shown at
// twice that, nearest neighbour (`.px`).
import { img, type El } from "pumi";

export const sprite = (name: string, cls: string): El => img(`images/${name}.svg`).class(`px ${cls}`);
