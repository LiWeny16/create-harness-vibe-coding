/// <reference types="vite/client" />

declare module '@server/excalidraw-svg.mjs' {
  export function renderSceneSvg(
    elements: unknown[],
    options?: { width?: number; fit?: 'width' | 'contain'; fillMode?: 'excalidraw' | 'plain' }
  ): string;
}
