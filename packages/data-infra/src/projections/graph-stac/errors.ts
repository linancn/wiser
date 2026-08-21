export type GraphStacProjectionErrorCode =
  | 'INVALID_GRAPH_CONFIGURATION'
  | 'INVALID_PROJECTION_INPUT'
  | 'INVALID_STAC_CONFIGURATION'
  | 'PROJECTION_UNAVAILABLE';

const messages: Readonly<Record<GraphStacProjectionErrorCode, string>> = {
  INVALID_GRAPH_CONFIGURATION:
    'Knowledge graph projection configuration is invalid.',
  INVALID_PROJECTION_INPUT: 'Graph/STAC projection input is invalid.',
  INVALID_STAC_CONFIGURATION: 'STAC projection configuration is invalid.',
  PROJECTION_UNAVAILABLE: 'Graph/STAC projection service is unavailable.',
};

export class GraphStacProjectionError extends Error {
  readonly code: GraphStacProjectionErrorCode;

  constructor(code: GraphStacProjectionErrorCode) {
    super(messages[code]);
    this.name = 'GraphStacProjectionError';
    this.code = code;
  }
}
