/* eslint-disable @typescript-eslint/naming-convention */

export type ApiSection = 'io' | 'oo' | 'ic' | 'oc';
export type ApiDirection = 'input' | 'output';

export interface ApiParameterLike {
  ':@'?: {
    '@_base_type'?: string;
    '@_dimension'?: number;
    '@_name'?: string;
  };
}

export interface ApiCellLike {
  value: string;
  metadata?: {
    apiSection?: unknown;
  };
}

export function formatAPIParameters(
  parameters: ApiParameterLike[],
  descriptions: Map<string, string> = new Map(),
  direction?: ApiDirection
): string {
  if (!parameters || parameters.length === 0) {
    return '';
  }

  return parameters
    .map((parameter) => {
      const paramData = parameter[':@'];
      if (!paramData) {
        return '';
      }

      const baseType = paramData['@_base_type'] || 'ctrl';
      const dimension = paramData['@_dimension'] || 0;
      const name = paramData['@_name'] || '';

      if (!name) {
        return '';
      }

      const dimensionSuffix = dimension !== 0 ? `[${dimension}]` : '';
      const directionPrefix = direction ? `[${direction === 'input' ? 'INPUT' : 'OUTPUT'}] ` : '';
      const description = descriptions.get(name) || '';
      const descriptionComment = description ? `  // ${description}` : '';

      return `${directionPrefix}${baseType} ${name}${dimensionSuffix}${descriptionComment}`;
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

export function inferApiSectionFromText(text: string): ApiSection | undefined {
  const firstMeaningfulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstMeaningfulLine) {
    return undefined;
  }

  const lineWithoutComment = firstMeaningfulLine.split('//')[0].trim();
  const match = lineWithoutComment.match(/^(?:\[(INPUT|OUTPUT)\]\s+)?(iconic|ctrl)\s+/i);

  if (!match) {
    return undefined;
  }

  const [, direction, baseType] = match;
  const normalizedBaseType = baseType.toLowerCase();
  const normalizedDirection = direction?.toUpperCase();

  if (normalizedDirection === 'INPUT' && normalizedBaseType === 'iconic') {
    return 'io';
  }
  if (normalizedDirection === 'OUTPUT' && normalizedBaseType === 'iconic') {
    return 'oo';
  }
  if (normalizedDirection === 'INPUT' && normalizedBaseType === 'ctrl') {
    return 'ic';
  }
  if (normalizedDirection === 'OUTPUT' && normalizedBaseType === 'ctrl') {
    return 'oc';
  }

  return undefined;
}

export function resolveApiSectionCells<T extends ApiCellLike>(
  cells: T[]
): Partial<Record<ApiSection, T>> {
  const resolved: Partial<Record<ApiSection, T>> = {};
  const unresolved: T[] = [];

  for (const cell of cells) {
    const metadataSection = cell.metadata?.apiSection;
    const section = isApiSection(metadataSection)
      ? metadataSection
      : inferApiSectionFromText(cell.value);

    if (section && !resolved[section]) {
      resolved[section] = cell;
      continue;
    }

    unresolved.push(cell);
  }

  for (const section of ['io', 'oo', 'ic', 'oc'] as ApiSection[]) {
    if (!resolved[section] && unresolved.length > 0) {
      resolved[section] = unresolved.shift();
    }
  }

  return resolved;
}

function isApiSection(value: unknown): value is ApiSection {
  return value === 'io' || value === 'oo' || value === 'ic' || value === 'oc';
}
