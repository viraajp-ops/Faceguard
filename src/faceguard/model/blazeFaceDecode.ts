export type BlazeFaceBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  score: number;
  keypoints: Array<{ x: number; y: number }>;
};

const SSD_OPTIONS_SHORT = {
  num_layers: 4,
  input_size_height: 128,
  input_size_width: 128,
  anchor_offset_x: 0.5,
  anchor_offset_y: 0.5,
  strides: [8, 16, 16, 16],
  interpolated_scale_aspect_ratio: 1.0
};

const RAW_SCORE_LIMIT = 80;
const MIN_SCORE = 0.5;
const INPUT_SIZE = 128;

const ANCHORS = generateAnchors(SSD_OPTIONS_SHORT);

type NumericArray = { length: number; [index: number]: number | bigint };

export function decodeBestBlazeFace(
  rawBoxes: NumericArray | ArrayBuffer,
  rawScores: NumericArray | ArrayBuffer
): BlazeFaceBox | undefined {
  const boxes = decodeBoxes(asNumericArray(rawBoxes));
  let best: BlazeFaceBox | undefined;

  const scoreArray = asNumericArray(rawScores);
  for (let index = 0; index < scoreArray.length; index += 1) {
    const score = sigmoid(clamp(toFloat(scoreArray[index]), -RAW_SCORE_LIMIT, RAW_SCORE_LIMIT));
    if (score < MIN_SCORE) {
      continue;
    }

    const candidate = boxes[index];
    if (!candidate || candidate.xmax <= candidate.xmin || candidate.ymax <= candidate.ymin) {
      continue;
    }

    if (!best || score > best.score) {
      best = {
        ...candidate,
        score
      };
    }
  }

  return best;
}

function decodeBoxes(rawBoxes: NumericArray): Array<
  Omit<BlazeFaceBox, 'score'>
> {
  const numAnchors = ANCHORS.length;
  const numPoints = 8;
  const decoded: Array<Omit<BlazeFaceBox, 'score'>> = [];

  for (let anchorIndex = 0; anchorIndex < numAnchors; anchorIndex += 1) {
    const points: Array<{ x: number; y: number }> = [];
    for (let pointIndex = 0; pointIndex < numPoints; pointIndex += 1) {
      const offset = anchorIndex * numPoints * 2 + pointIndex * 2;
      let x = toFloat(rawBoxes[offset]) / INPUT_SIZE;
      let y = toFloat(rawBoxes[offset + 1]) / INPUT_SIZE;
      if (pointIndex === 0 || pointIndex >= 2) {
        x += ANCHORS[anchorIndex][0];
        y += ANCHORS[anchorIndex][1];
      }
      points.push({ x, y });
    }

    const center = points[0];
    const half = {
      x: points[1].x / 2,
      y: points[1].y / 2
    };
    const xmin = center.x - half.x;
    const ymin = center.y - half.y;
    const xmax = center.x + half.x;
    const ymax = center.y + half.y;

    decoded.push({
      xmin,
      ymin,
      xmax,
      ymax,
      keypoints: points.slice(2)
    });
  }

  return decoded;
}

function generateAnchors(opts: typeof SSD_OPTIONS_SHORT): Array<[number, number]> {
  const anchors: Array<[number, number]> = [];
  let layerId = 0;

  while (layerId < opts.num_layers) {
    let lastSameStrideLayer = layerId;
    let repeats = 0;

    while (
      lastSameStrideLayer < opts.num_layers &&
      opts.strides[lastSameStrideLayer] === opts.strides[layerId]
    ) {
      lastSameStrideLayer += 1;
      repeats += opts.interpolated_scale_aspect_ratio === 1.0 ? 2 : 1;
    }

    const stride = opts.strides[layerId];
    const featureMapHeight = Math.floor(opts.input_size_height / stride);
    const featureMapWidth = Math.floor(opts.input_size_width / stride);

    for (let y = 0; y < featureMapHeight; y += 1) {
      const yCenter = (y + opts.anchor_offset_y) / featureMapHeight;
      for (let x = 0; x < featureMapWidth; x += 1) {
        const xCenter = (x + opts.anchor_offset_x) / featureMapWidth;
        for (let repeat = 0; repeat < repeats; repeat += 1) {
          anchors.push([xCenter, yCenter]);
        }
      }
    }

    layerId = lastSameStrideLayer;
  }

  return anchors;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toFloat(value: number | bigint): number {
  return Number(value);
}

function asNumericArray(values: NumericArray | ArrayBuffer): NumericArray {
  if (values instanceof ArrayBuffer) {
    const floats = new Float32Array(values);
    return floats as unknown as NumericArray;
  }

  return values;
}
