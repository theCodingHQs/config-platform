import '@testing-library/jest-dom';

// Mock Canvas 2D context for jsdom in Univer tests
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (contextType: string) {
    if (contextType === '2d') {
      return {
        fillRect: () => {},
        clearRect: () => {},
        getImageData: () => ({ data: new Array(4) }),
        putImageData: () => {},
        createImageData: () => [],
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        fillText: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        arc: () => {},
        arcTo: () => {},
        bezierCurveTo: () => {},
        quadraticCurveTo: () => {},
        ellipse: () => {},
        setLineDash: () => {},
        getLineDash: () => [],
        strokeRect: () => {},
        strokeText: () => {},
        isPointInPath: () => false,
        fill: () => {},
        measureText: () => ({ width: 10 }),
        transform: () => {},
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, m11: 1, m12: 0, m21: 0, m22: 1, m41: 0, m42: 0 }),
        resetTransform: () => {},
        rect: () => {},
        clip: () => {},
        createPattern: () => null,
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
      } as any;
    }
    return null;
  };
}

// jsdom has no Path2D; @univerjs/sheets-data-validation-ui builds checkbox paths at import time
if (typeof (globalThis as any).Path2D === 'undefined') {
  (globalThis as any).Path2D = class {
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
    roundRect() {}
  };
}
