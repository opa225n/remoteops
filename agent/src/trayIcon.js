// Construit une icône simple (un rond plein) directement en mémoire, pour
// l'icône système de l'agent — sans dépendre d'un fichier image externe.
// Un vrai fichier .png/.ico illustré reste préférable avant diffusion
// large (voir agent/README.md), mais ceci garantit qu'aucune icône
// invisible n'empêche de retrouver et de quitter l'agent.
"use strict";

import { nativeImage } from "electron";

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * @param {number} size côté de l'image en pixels
 * @param {string} hexColor couleur de remplissage, ex. "#22c55e"
 */
export function createDotIcon(size, hexColor) {
  const { r, g, b } = hexToRgb(hexColor);
  // nativeImage.createFromBitmap attend un tampon BGRA (documenté ainsi
  // quelle que soit la plateforme), d'où l'ordre b,g,r,a ci-dessous.
  const buffer = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const idx = (y * size + x) * 4;
      if (dx * dx + dy * dy <= radius * radius) {
        buffer[idx] = b;
        buffer[idx + 1] = g;
        buffer[idx + 2] = r;
        buffer[idx + 3] = 255;
      } else {
        buffer[idx + 3] = 0; // transparent hors du cercle
      }
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}
