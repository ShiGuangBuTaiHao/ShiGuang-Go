<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { BoardStyle } from "../../domain/boardTheme";
import type {
  Board,
  CandidateMarker,
  Move,
  MoveNumberMarker,
  Position,
  Stone,
  TerritoryMarker,
} from "../../types/game";
import type { BoardMark, BoardMarkType } from "../../types/research";

const props = defineProps<{
  board: Board;
  currentPlayer: Stone;
  lastMove: Move | null;
  candidates: CandidateMarker[];
  territory: TerritoryMarker[];
  territoryMode: "current" | "ai";
  showStarPoints: boolean;
  showCoordinates: boolean;
  deadStones: Position[];
  moveNumbers: MoveNumberMarker[];
  showMoveNumbers: boolean;
  boardStyle: BoardStyle;
  disabled: boolean;
  busy: boolean;
  marks?: BoardMark[];
  markPreviewType?: BoardMarkType | null;
}>();
const emit = defineEmits<{ place: [row: number, col: number] }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const host = ref<HTMLDivElement | null>(null);
const hover = ref<{ row: number; col: number } | null>(null);
let observer: ResizeObserver | undefined;
let stageObserver: ResizeObserver | undefined;
let themeObserver: MutationObserver | undefined;
let colorScheme: MediaQueryList | undefined;
const glassStoneSprites = new Map<string, HTMLCanvasElement>();
const stoneImages: Record<Stone, HTMLImageElement> = {
  black: new Image(),
  white: new Image(),
};

stoneImages.black.src = "/board-themes/classic/stone-black.svg";
stoneImages.white.src = "/board-themes/classic/stone-white.svg";
stoneImages.black.addEventListener("load", render);
stoneImages.white.addEventListener("load", render);

function geometry(size: number) {
  const padding = size * 0.055;
  return { padding, cell: (size - padding * 2) / (props.board.length - 1) };
}

function adjustSize() {
  const container = host.value;
  if (!container) return;

  // find nearest board-stage
  const stage = container.closest?.('.board-stage') || document.querySelector('.board-stage');
  if (!stage) {
    const fallback = Math.max(360, Math.min(window.innerWidth, window.innerHeight));
    container.style.width = `${fallback}px`;
    container.style.height = `${fallback}px`;
    return;
  }

  const style = window.getComputedStyle(stage);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;

  // Keep the board inside the viewport on narrow screens even while the
  // surrounding layout is still settling after the side panel stacks below it.
  const isCompact = window.matchMedia('(max-width: 760px)').matches;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const compactLimit = isCompact
    ? Math.max(0, viewportWidth - padLeft - padRight)
    : Number.POSITIVE_INFINITY;
  const minimumSize = isCompact ? Math.min(360, compactLimit) : 360;
  const availableWidth = Math.max(minimumSize, Math.floor(stage.clientWidth - padLeft - padRight));
  const availableHeight = Math.max(minimumSize, Math.floor(stage.clientHeight - padTop - padBottom));

  const size = Math.max(minimumSize, Math.min(availableWidth, availableHeight, compactLimit));

  container.style.width = `${size}px`;
  container.style.height = `${size}px`;
}

const resizeHandler = () => {
  adjustSize();
  // after size adjusted, render will be triggered by ResizeObserver observing host
};

function drawGlassThemeStone(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  stone: Stone,
  alpha: number
) {
  const pixelRatio = window.devicePixelRatio || 1;
  const key = `${stone}:${radius.toFixed(3)}:${pixelRatio.toFixed(2)}`;
  const spriteSize = radius * 2.7;
  let sprite = glassStoneSprites.get(key);
  if (!sprite) {
    sprite = document.createElement("canvas");
    sprite.width = Math.ceil(spriteSize * pixelRatio);
    sprite.height = Math.ceil(spriteSize * pixelRatio);
    const paint = sprite.getContext("2d");
    if (!paint) return;
    paint.scale(pixelRatio, pixelRatio);
    const center = spriteSize / 2;
    const black = stone === "black";
    const body = paint.createRadialGradient(
      center - radius * 0.3, center - radius * 0.38, radius * 0.04,
      center, center, radius
    );
    body.addColorStop(0, black ? "#36383c" : "#fafbf1");
    body.addColorStop(0.42, black ? "#17191d" : "#f0f2e5");
    body.addColorStop(0.8, black ? "#08090c" : "#dce2d2");
    body.addColorStop(1, black ? "#131519" : "#bac6b5");

    paint.save();
    paint.shadowColor = "rgba(3, 7, 18, 0.12)";
    paint.shadowBlur = radius * 0.12;
    paint.shadowOffsetY = radius * 0.06;
    paint.beginPath();
    paint.arc(center, center, radius, 0, Math.PI * 2);
    paint.fillStyle = body;
    paint.fill();
    paint.restore();
    paint.lineWidth = Math.max(0.75, radius * 0.045);
    paint.strokeStyle = black ? "rgba(122, 129, 140, 0.48)" : "rgba(114, 129, 110, 0.42)";
    paint.stroke();

    // Broad, low-contrast inclusions give white jade depth without a marble vein pattern.
    if (!black) {
      paint.save();
      paint.clip();
      for (const [offsetX, offsetY, spread] of [[-0.3, 0.24, 0.54], [0.38, -0.12, 0.42], [0.1, 0.48, 0.36]] as const) {
        const cloud = paint.createRadialGradient(
          center + radius * offsetX, center + radius * offsetY, 0,
          center + radius * offsetX, center + radius * offsetY, radius * spread
        );
        cloud.addColorStop(0, "rgba(255, 255, 246, 0.28)");
        cloud.addColorStop(1, "rgba(255, 255, 246, 0)");
        paint.fillStyle = cloud;
        paint.fillRect(center - radius, center - radius, radius * 2, radius * 2);
      }
      paint.restore();
    }

    const highlight = paint.createRadialGradient(
      center - radius * 0.3, center - radius * 0.46, 0,
      center - radius * 0.15, center - radius * 0.28, radius * 0.96
    );
    highlight.addColorStop(0, black ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 248, 0.32)");
    highlight.addColorStop(0.48, "rgba(255, 255, 255, 0.04)");
    highlight.addColorStop(1, "rgba(255, 255, 255, 0)");
    paint.fillStyle = highlight;
    paint.fill();

    if (black) {
      paint.save();
      paint.translate(center - radius * 0.3, center - radius * 0.43);
      paint.rotate(-Math.PI / 5);
      paint.scale(1, 0.45);
      const reflection = paint.createRadialGradient(0, 0, 0, 0, 0, radius * 0.43);
      reflection.addColorStop(0, "rgba(255, 255, 255, 0.65)");
      reflection.addColorStop(0.38, "rgba(232, 237, 245, 0.28)");
      reflection.addColorStop(1, "rgba(232, 237, 245, 0)");
      paint.fillStyle = reflection;
      paint.beginPath();
      paint.arc(0, 0, radius * 0.43, 0, Math.PI * 2);
      paint.fill();
      paint.restore();
    }

    paint.beginPath();
    paint.arc(center, center, radius * 0.94, Math.PI * 1.12, Math.PI * 1.85);
    paint.lineWidth = Math.max(0.65, radius * 0.04);
    paint.strokeStyle = black ? "rgba(255, 255, 255, 0.28)" : "rgba(255, 255, 244, 0.65)";
    paint.stroke();
    paint.beginPath();
    paint.arc(center, center, radius * 0.94, Math.PI * 0.12, Math.PI * 0.85);
    paint.strokeStyle = black ? "rgba(2, 6, 16, 0.18)" : "rgba(99, 116, 92, 0.12)";
    paint.stroke();

    // Bound the cache while a window is being resized continuously.
    if (glassStoneSprites.size >= 8) glassStoneSprites.clear();
    glassStoneSprites.set(key, sprite);
  }
  context.save();
  context.globalAlpha = alpha;
  context.drawImage(sprite, x - spriteSize / 2, y - spriteSize / 2, spriteSize, spriteSize);
  context.restore();
}

function drawStone(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  stone: Stone,
  alpha = 1
) {
  if (props.boardStyle === "glassmorphism") {
    drawGlassThemeStone(context, x, y, radius, stone, alpha);
    return;
  }

  if (props.boardStyle === "minimal") {
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = stone === "black" ? "#252a29" : "#fbfbf8";
    context.fill();
    context.lineWidth = Math.max(0.8, radius * 0.055);
    context.strokeStyle = stone === "black" ? "#151918" : "#8b928f";
    context.stroke();
    context.restore();
    return;
  }

  const image = stoneImages[stone];
  if (!image.complete || image.naturalWidth === 0) return;

  context.save();
  context.globalAlpha = alpha;
  const spriteSize = radius * 2.24;
  context.drawImage(
    image,
    x - spriteSize / 2,
    y - spriteSize / 2,
    spriteSize,
    spriteSize
  );
  context.restore();
}

function columnLabel(col: number) {
  return 'ABCDEFGHJKLMNOPQRST'[col] ?? '';
}

function render() {
  const element = canvas.value;
  const container = host.value;
  if (!element || !container) return;

  const size = container.clientWidth;
  const pixelRatio = window.devicePixelRatio || 1;
  element.width = Math.round(size * pixelRatio);
  element.height = Math.round(size * pixelRatio);
  element.style.width = `${size}px`;
  element.style.height = `${size}px`;

  const context = element.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, size, size);

  const { padding, cell } = geometry(size);
  const minimal = props.boardStyle === "minimal";
  const glass = props.boardStyle === "glassmorphism";
  if (minimal) {
    context.fillStyle = "#d7b47a";
    context.fillRect(0, 0, size, size);
  }
  const surfaceStyle = getComputedStyle(container);
  const themeAccent = surfaceStyle
    .getPropertyValue("--accent")
    .trim() || "#0078d4";
  const gridColor = glass ? surfaceStyle.color : minimal
    ? "#60492f"
    : "rgba(62, 42, 22, 0.72)";
  const labelColor = glass ? surfaceStyle.color : minimal
    ? "#594329"
    : "rgba(67, 45, 24, 0.82)";
  const starColor = glass ? surfaceStyle.color : minimal ? "#3f2d1b" : "#3b2714";
  context.strokeStyle = gridColor;
  context.lineWidth = Math.max(1, size / 760);

  if (props.showCoordinates) {
    const labelSize = Math.max(9, Math.min(14, cell * 0.26));
    const edgeOffset = padding * 0.46;
    context.fillStyle = labelColor;
    context.font = `600 ${labelSize}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (let index = 0; index < props.board.length; index += 1) {
      const offset = padding + index * cell;
      const letter = columnLabel(index);
      context.fillText(letter, offset, edgeOffset);
      context.fillText(letter, offset, size - edgeOffset);
      context.fillText(String(props.board.length - index), edgeOffset, offset);
      context.fillText(String(props.board.length - index), size - edgeOffset, offset);
    }
  }

  context.globalAlpha = glass ? 0.62 : 1;
  for (let index = 0; index < props.board.length; index += 1) {
    const offset = padding + index * cell;
    context.beginPath();
    context.moveTo(padding, offset);
    context.lineTo(size - padding, offset);
    context.stroke();
    context.beginPath();
    context.moveTo(offset, padding);
    context.lineTo(offset, size - padding);
    context.stroke();
  }
  context.globalAlpha = 1;

  if (props.showStarPoints) {
    const starPoints = [3, 9, 15];
    context.fillStyle = starColor;
    for (const row of starPoints) {
      for (const col of starPoints) {
        context.beginPath();
        context.arc(
          padding + col * cell,
          padding + row * cell,
          Math.max(2.4, cell * 0.1),
          0,
          Math.PI * 2
        );
        context.fill();
      }
    }
  }

  const radius = cell * 0.46;
  const moveNumberMap = new Map(
    props.moveNumbers.map((marker) => [`${marker.row}:${marker.col}`, marker])
  );
  props.board.forEach((row, rowIndex) => {
    row.forEach((stone, colIndex) => {
      if (!stone) return;
      const x = padding + colIndex * cell;
      const y = padding + rowIndex * cell;
      drawStone(context, x, y, radius, stone);

      const moveMarker = moveNumberMap.get(`${rowIndex}:${colIndex}`);
      if (props.showMoveNumbers && moveMarker) {
        const label = String(moveMarker.moveNumber);
        context.fillStyle = stone === "black" ? "#f5f6f6" : "#25292b";
        context.font = `600 ${Math.max(
          8,
          cell * (label.length > 2 ? 0.22 : 0.28)
        )}px "Segoe UI", sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, x, y + cell * 0.015);
      } else if (
        props.lastMove?.row === rowIndex &&
        props.lastMove?.col === colIndex
      ) {
        context.beginPath();
        context.arc(x, y, cell * 0.1, 0, Math.PI * 2);
        context.fillStyle = themeAccent;
        context.fill();
      }
    });
  });

  props.marks?.forEach((mark) => {
    const point = mark.row === undefined || mark.col === undefined
      ? null
      : { x: padding + mark.col * cell, y: padding + mark.row * cell };
    if (!point) return;
    const markSize = cell * 0.28;
    context.save();
    context.strokeStyle = themeAccent;
    context.fillStyle = themeAccent;
    context.lineWidth = Math.max(1.5, cell * 0.045);
    context.lineJoin = "round";
    if (mark.type === "circle") {
      context.beginPath();
      context.arc(point.x, point.y, markSize, 0, Math.PI * 2);
      context.stroke();
    } else if (mark.type === "square") {
      context.strokeRect(point.x - markSize, point.y - markSize, markSize * 2, markSize * 2);
    } else if (mark.type === "triangle") {
      context.beginPath();
      context.moveTo(point.x, point.y - markSize);
      context.lineTo(point.x + markSize, point.y + markSize * 0.82);
      context.lineTo(point.x - markSize, point.y + markSize * 0.82);
      context.closePath();
      context.stroke();
    } else if (mark.type === "cross") {
      context.beginPath();
      context.moveTo(point.x - markSize, point.y - markSize);
      context.lineTo(point.x + markSize, point.y + markSize);
      context.moveTo(point.x + markSize, point.y - markSize);
      context.lineTo(point.x - markSize, point.y + markSize);
      context.stroke();
    }
    context.restore();
  });

  // Current shape uses solid squares. AI prediction restores the older visual
  // language: solid squares for strong ownership and dashed hollow squares
  // for uncertain ownership. Recommendation markers have higher visual
  // priority, so hide the shape square underneath an overlapping candidate.
  const candidateKeys = new Set(
    props.candidates.map((candidate) => `${candidate.row}:${candidate.col}`)
  );
  props.territory.forEach((marker) => {
    if (candidateKeys.has(`${marker.row}:${marker.col}`)) return;
    const x = padding + marker.col * cell;
    const y = padding + marker.row * cell;
    const size =
      cell * Math.min(0.42, Math.max(0.1, 0.1 + marker.confidence * 0.3));
    if (size <= 0) return;
    context.save();
    const color = marker.owner === "black" ? "#242629" : "#f7f7f4";
    context.globalAlpha = 1;
    context.lineWidth = Math.max(1, cell * 0.012);
    context.strokeStyle = glass
      ? marker.owner === "black" ? "#f7f7f4" : "#242629"
      : marker.owner === "black" ? "#242629" : "#b8b8b3";

    if (props.territoryMode === "ai" && marker.zone !== "sure") {
      context.setLineDash([Math.max(1, cell * 0.06), Math.max(1, cell * 0.06)]);
      if (glass) {
        context.lineWidth = 3;
        context.strokeRect(x - size / 2, y - size / 2, size, size);
        context.lineWidth = 1;
      }
      context.strokeStyle = color;
      context.strokeRect(x - size / 2, y - size / 2, size, size);
    } else {
      context.setLineDash([]);
      context.fillStyle = color;
      context.fillRect(x - size / 2, y - size / 2, size, size);
      context.strokeRect(x - size / 2, y - size / 2, size, size);
    }
    context.restore();
  });

  // Automatically judged dead stones use a distinct solid square marker.
  props.deadStones.forEach((point) => {
    const x = padding + point.col * cell;
    const y = padding + point.row * cell;
    const size = cell * 0.28;
    const deadStone = props.board[point.row]?.[point.col];
    const markerColor = deadStone === "white" ? "#242629" : "#f7f7f4";
    const borderColor = deadStone === "white" ? "#0f1011" : "#b8b8b3";
    context.save();
    context.globalAlpha = 1;
    context.fillStyle = markerColor;
    context.fillRect(x - size / 2, y - size / 2, size, size);
    context.strokeStyle = borderColor;
    context.lineWidth = Math.max(1, cell * 0.012);
    context.strokeRect(x - size / 2, y - size / 2, size, size);
    context.restore();
  });

  const bestCandidate = props.candidates.reduce<CandidateMarker | undefined>(
    (best, candidate) => !best || candidate.rank < best.rank ? candidate : best,
    undefined
  );
  props.candidates.forEach((candidate) => {
    if (props.board[candidate.row]?.[candidate.col]) return;
    const x = padding + candidate.col * cell;
    const y = padding + candidate.row * cell;
    if (glass) {
      const best = candidate === bestCandidate;
      const label = `${candidate.percentage}%`;
      context.save();
      context.beginPath();
      context.arc(x, y, cell * 0.4, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 255, 255, 0.08)";
      context.fill();
      context.strokeStyle = best ? themeAccent : surfaceStyle.color;
      context.lineWidth = best ? 2 : 1;
      if (!best) context.setLineDash([cell * 0.09, cell * 0.06]);
      context.stroke();
      context.font = `700 ${Math.max(8, cell * 0.23)}px "Segoe UI", sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.lineWidth = 2.5;
      context.strokeStyle = "#141619";
      context.strokeText(label, x, y, cell * 0.76);
      context.fillStyle = "#ffffff";
      context.fillText(label, x, y, cell * 0.76);
      context.restore();
      return;
    }
    const opacity = Math.min(0.9, Math.max(0.32, 0.2 + candidate.percentage / 100 * 0.7));
    context.beginPath();
    context.arc(x, y, cell * 0.32, 0, Math.PI * 2);
    context.fillStyle = `rgba(47, 143, 91, ${opacity})`;
    context.fill();
    context.font = `700 ${Math.max(10, cell * 0.2)}px "Segoe UI", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = Math.max(2, cell * 0.035);
    context.strokeStyle = "rgba(255, 255, 255, 0.86)";
    context.strokeText(`${candidate.percentage}%`, x, y + cell * 0.01);
    context.fillStyle = "#111815";
    context.fillText(`${candidate.percentage}%`, x, y + cell * 0.01);
  });

  const preview = hover.value;
  if (preview && props.markPreviewType && !props.board[preview.row][preview.col]) {
    const x = padding + preview.col * cell;
    const y = padding + preview.row * cell;
    const markSize = cell * 0.28;
    context.save();
    context.globalAlpha = 0.55;
    context.strokeStyle = themeAccent;
    context.lineWidth = Math.max(1.5, cell * 0.045);
    context.lineJoin = "round";
    if (props.markPreviewType === "circle") {
      context.beginPath();
      context.arc(x, y, markSize, 0, Math.PI * 2);
      context.stroke();
    } else if (props.markPreviewType === "square") {
      context.strokeRect(x - markSize, y - markSize, markSize * 2, markSize * 2);
    } else if (props.markPreviewType === "triangle") {
      context.beginPath();
      context.moveTo(x, y - markSize);
      context.lineTo(x + markSize, y + markSize * 0.82);
      context.lineTo(x - markSize, y + markSize * 0.82);
      context.closePath();
      context.stroke();
    } else if (props.markPreviewType === "cross") {
      context.beginPath();
      context.moveTo(x - markSize, y - markSize);
      context.lineTo(x + markSize, y + markSize);
      context.moveTo(x + markSize, y - markSize);
      context.lineTo(x - markSize, y + markSize);
      context.stroke();
    }
    context.restore();
  } else if (preview && !props.board[preview.row][preview.col]) {
    drawStone(
      context,
      padding + preview.col * cell,
      padding + preview.row * cell,
      radius,
      props.currentPlayer,
      0.48
    );
  }
}

function pointFromEvent(event: PointerEvent) {
  const element = canvas.value;
  if (!element) return null;
  const bounds = element.getBoundingClientRect();
  const { padding, cell } = geometry(bounds.width);
  const col = Math.round((event.clientX - bounds.left - padding) / cell);
  const row = Math.round((event.clientY - bounds.top - padding) / cell);
  if (
    row < 0 ||
    col < 0 ||
    row >= props.board.length ||
    col >= props.board.length
  )
    return null;

  const targetX = bounds.left + padding + col * cell;
  const targetY = bounds.top + padding + row * cell;
  if (
    Math.hypot(event.clientX - targetX, event.clientY - targetY) >
    cell * 0.48
  )
    return null;
  return { row, col };
}

function onPointerMove(event: PointerEvent) {
  if (props.disabled) return;
  hover.value = pointFromEvent(event);
  render();
}

function onPointerLeave() {
  hover.value = null;
  render();
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled) return;
  const point = pointFromEvent(event);
  if (point) emit("place", point.row, point.col);
}

watch(
  () => [
    props.board,
    props.currentPlayer,
    props.lastMove,
    props.candidates,
    props.territory,
    props.showStarPoints,
    props.showCoordinates,
    props.deadStones,
    props.moveNumbers,
    props.showMoveNumbers,
    props.boardStyle,
    props.marks,
    props.markPreviewType,
  ],
  render,
  { deep: true }
);

onMounted(() => {
  // adjust size based on available viewport and surrounding UI
  adjustSize();

  // observe host size changes to re-render canvas
  observer = new ResizeObserver(render);
  if (host.value) observer.observe(host.value);

  // observe stage size changes (e.g., sidebar resize) and window resize to recalc board size
  const stage =
    host.value?.closest?.(".board-stage") ||
    document.querySelector(".board-stage");
  if (stage) {
    stageObserver = new ResizeObserver(resizeHandler);
    stageObserver.observe(stage);
  }
  window.addEventListener("resize", resizeHandler);

  // initial render
  render();

  // Canvas does not repaint itself when CSS theme tokens change.
  themeObserver = new MutationObserver(render);
  for (const element of [document.documentElement, document.body]) {
    themeObserver.observe(element, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  }
  colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  colorScheme.addEventListener("change", render);
});

onBeforeUnmount(() => {
  stoneImages.black.removeEventListener("load", render);
  stoneImages.white.removeEventListener("load", render);
  observer?.disconnect();
  stageObserver?.disconnect();
  themeObserver?.disconnect();
  colorScheme?.removeEventListener("change", render);
  glassStoneSprites.clear();
  window.removeEventListener("resize", resizeHandler);
});
</script>

<template>
  <div ref="host" class="board-host" :class="`board-${props.boardStyle}`">
    <canvas
      ref="canvas"
      class="go-board"
      :class="{ disabled, busy }"
      aria-label="十九路围棋棋盘"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
      @pointerdown="onPointerDown"
    />
  </div>
</template>

<style scoped>
.board-host {
  /* host size is controlled by JS adjustSize to avoid fractional overflow/scroll issues */
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  min-width: 360px;
  box-sizing: border-box;
  border: 1px solid transparent;
  box-shadow: none;
}

.board-host.board-classic {
  background-color: #cfaa6c;
  background-image: url('/board-themes/classic/board-wood.jpg');
  background-position: center;
  background-size: cover;
  border: 1px solid #a77a3f;
}

.board-host.board-minimal {
  background: #d7b47a;
  border-color: #a27c49;
}

.board-host.board-glassmorphism {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 24px;
  color: var(--text);
  background-color: rgba(255, 255, 255, 0.08);
  background-image: linear-gradient(to bottom, rgba(255, 255, 255, 0.06), transparent 50%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  backdrop-filter: blur(60px) saturate(180%);
  box-shadow: 0 3px 10px -4px rgba(3, 7, 18, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 0 rgba(2, 6, 16, 0.16);
  transition: border-color 500ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 500ms cubic-bezier(0.16, 1, 0.3, 1);
}

.board-glassmorphism::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  border-radius: inherit;
  background: url('/board-themes/glassmorphism/grain.svg') repeat;
  opacity: 0.025;
  pointer-events: none;
  content: '';
}

.board-glassmorphism .go-board {
  position: relative;
  z-index: 1;
}

@media (hover: hover) {
  .board-host.board-glassmorphism:hover {
    border-color: rgba(255, 255, 255, 0.3);
    box-shadow: 0 3px 10px -4px rgba(3, 7, 18, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.65), inset 0 -1px 0 rgba(2, 6, 16, 0.16);
  }
}

@media (max-width: 760px) {
  .board-host.board-glassmorphism {
    border-radius: 16px;
    -webkit-backdrop-filter: blur(30px) saturate(180%);
    backdrop-filter: blur(30px) saturate(180%);
    box-shadow: 0 2px 6px -3px rgba(3, 7, 18, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 0 rgba(2, 6, 16, 0.16);
  }
}

@media (prefers-reduced-motion: reduce) {
  .board-host.board-glassmorphism {
    transition: none;
  }
}

.go-board {
  display: block;
  touch-action: none;
  cursor: crosshair;
}

.go-board.disabled {
  cursor: not-allowed;
}

.go-board.disabled.busy {
  cursor: wait;
}

@media (max-width: 980px) {
  .board-host {
    width: min(calc(100vw - 24px), 100%) !important;
    height: min(calc(100vw - 24px), 100%) !important;
    min-width: 0;
  }
}
</style>
