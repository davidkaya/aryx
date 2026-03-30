import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = import.meta.dir ?? fileURLToPath(new URL('.', import.meta.url));
const websiteDir = join(scriptDir, '..');

const fontUrls = {
  instrumentSerif:
    'https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-2zI.ttf',
  outfit400:
    'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4TC1C4E.ttf',
  outfit300:
    'https://fonts.gstatic.com/s/outfit/v15/QGYyz_MVcBeNP4NjuGObqx1XmO1I4W61C4E.ttf',
};

const colors = {
  deep: '#08080a',
  border: '#2a2a34',
  warm50: '#ede9e2',
  warm300: '#a09a90',
  brand: '#245CF9',
  brandBright: '#248CFD',
  accent: '#8A29E6',
};

type SatoriNode = string | SatoriElement;
interface SatoriElement {
  type: string;
  props: Record<string, unknown> & { children?: SatoriNode | SatoriNode[] };
}

function toDataUri(filePath: string, mime: string): string {
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
}

function orb(
  top: number | undefined,
  bottom: number | undefined,
  left: number | undefined,
  right: number | undefined,
  size: number,
  color: string,
  opacity: number,
  spread = 0.7,
): SatoriElement {
  return {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        ...(top !== undefined && { top }),
        ...(bottom !== undefined && { bottom }),
        ...(left !== undefined && { left }),
        ...(right !== undefined && { right }),
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color.replace(')', `,${opacity})`).replace('rgb', 'rgba')} 0%, ${color.replace(')', ',0.02)').replace('rgb', 'rgba')} ${spread * 100}%, transparent 100%)`,
      },
    },
  };
}

function dot(top: number, left: number, size: number, color: string): SatoriElement {
  return {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        top,
        left,
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: color,
      },
    },
  };
}

async function generate() {
  console.log('Generating OG image…');

  const [instrumentSerif, outfit400, outfit300] = await Promise.all(
    Object.values(fontUrls).map((url) => fetch(url).then((r) => r.arrayBuffer())),
  );

  const logoUri = toDataUri(join(websiteDir, 'public', 'images', 'logo.png'), 'image/png');

  const element: SatoriElement = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: 1200,
        height: 630,
        backgroundColor: colors.deep,
        position: 'relative',
        overflow: 'hidden',
      },
      children: [
        // ── Background ambient glows (subtle, behind everything) ──
        orb(-120, undefined, 60, undefined, 500, 'rgb(36,92,249)', 0.07, 0.65),
        orb(undefined, -80, undefined, 200, 450, 'rgb(138,41,230)', 0.05, 0.6),

        // ── Top gradient accent bar ──
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: `linear-gradient(90deg, ${colors.brand}, ${colors.accent})`,
            },
          },
        },

        // ── Main content ──
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'row' as const,
              width: '100%',
              height: '100%',
              padding: '0 80px',
              alignItems: 'center',
            },
            children: [
              // Left column — text
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    flexDirection: 'column' as const,
                    flex: 1,
                    justifyContent: 'center',
                  },
                  children: [
                    // Logo
                    {
                      type: 'img',
                      props: {
                        src: logoUri,
                        width: 56,
                        height: 56,
                        style: { borderRadius: 14 },
                      },
                    },
                    // Product name
                    {
                      type: 'div',
                      props: {
                        style: {
                          fontFamily: 'Instrument Serif',
                          fontSize: 76,
                          color: colors.warm50,
                          marginTop: 24,
                          lineHeight: 1,
                          letterSpacing: -1,
                        },
                        children: 'Aryx',
                      },
                    },
                    // Tagline
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          flexWrap: 'wrap' as const,
                          fontFamily: 'Outfit',
                          fontSize: 26,
                          fontWeight: 300,
                          color: colors.warm300,
                          marginTop: 18,
                          lineHeight: 1.45,
                        },
                        children: [
                          'Your control room for ',
                          {
                            type: 'span',
                            props: {
                              style: { color: colors.brand },
                              children: 'Copilot-powered',
                            },
                          },
                          ' work',
                        ],
                      },
                    },
                    // Badge pill
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 30,
                          fontFamily: 'Outfit',
                          fontSize: 14,
                          color: colors.brand,
                          border: '1px solid rgba(36,92,249,0.2)',
                          background: 'rgba(36,92,249,0.06)',
                          borderRadius: 100,
                          padding: '7px 16px',
                          alignSelf: 'flex-start',
                        },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: {
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                backgroundColor: colors.brand,
                              },
                            },
                          },
                          'Desktop AI Workspace',
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },

        // ── Decorative orbs (right side) ──
        // Large blue orb
        orb(40, undefined, undefined, 40, 380, 'rgb(36,92,249)', 0.22, 0.55),
        // Large purple orb (overlapping)
        orb(undefined, 20, undefined, -40, 340, 'rgb(138,41,230)', 0.18, 0.5),
        // Bright blue accent orb
        orb(180, undefined, undefined, 220, 140, 'rgb(36,140,253)', 0.3, 0.5),

        // ── Thin ring ──
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: 100,
              right: 80,
              width: 240,
              height: 240,
              borderRadius: '50%',
              border: '1px solid rgba(36,92,249,0.12)',
            },
          },
        },
        // Smaller ring
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              bottom: 80,
              right: 160,
              width: 160,
              height: 160,
              borderRadius: '50%',
              border: '1px solid rgba(138,41,230,0.10)',
            },
          },
        },

        // ── Accent dots ──
        dot(140, 820, 8, 'rgba(36,92,249,0.4)'),
        dot(340, 950, 6, 'rgba(138,41,230,0.35)'),
        dot(480, 780, 5, 'rgba(36,140,253,0.3)'),
        dot(200, 1050, 4, 'rgba(36,92,249,0.25)'),
        dot(100, 1100, 7, 'rgba(138,41,230,0.2)'),
      ],
    },
  };

  const svg = await satori(element, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Instrument Serif', data: instrumentSerif, weight: 400, style: 'normal' as const },
      { name: 'Outfit', data: outfit400, weight: 400, style: 'normal' as const },
      { name: 'Outfit', data: outfit300, weight: 300, style: 'normal' as const },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();

  const outputPath = join(websiteDir, 'public', 'images', 'og.png');
  writeFileSync(outputPath, png);

  const sizeKb = (png.length / 1024).toFixed(1);
  console.log(`✓ OG image generated → public/images/og.png (${sizeKb} KB)`);
}

generate().catch((err) => {
  console.error('Failed to generate OG image:', err);
  process.exit(1);
});
