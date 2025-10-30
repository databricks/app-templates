type ErrorType =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limit'
  | 'offline'
  | 'empty';

type Surface =
  | 'chat'
  | 'auth'
  | 'api'
  | 'database'
  | 'history'
  | 'stream'
  | 'message';

export type ErrorCode = `${ErrorType}:${Surface}`;

type ErrorVisibility = 'response' | 'log' | 'none';

const visibilityBySurface: Record<Surface, ErrorVisibility> = {
  database: 'log',
  chat: 'response',
  auth: 'response',
  api: 'response',
  history: 'response',
  stream: 'response',
  message: 'response',
};

export class ChatSDKError extends Error {
  public type: ErrorType;
  public surface: Surface;
  public statusCode: number;
  public override cause?: string;

  constructor(errorCode: ErrorCode, cause?: string) {
    super();

    let type: ErrorType;
    let surface: Surface;
    try {
      const [_type, _surface] = errorCode.split(':');
      type = _type as ErrorType;
      surface = _surface as Surface;
    } catch (error) {
      console.error('Error parsing error code:', error);
      throw new Error('Invalid error code');
    }

    this.type = type as ErrorType;
    this.cause = cause;
    this.surface = surface as Surface;
    this.message = getMessageByErrorCode(errorCode);
    this.statusCode = getStatusCodeByType(this.type);
  }

  public toResponse() {
    const code: ErrorCode = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];

    const { message, cause, statusCode } = this;

    if (visibility === 'log') {
      console.error({
        code,
        message,
        cause,
      });

      return {
        status: statusCode,
        json: {
          code: '',
          message: 'Something went wrong. Please try again later.',
        },
      };
    }

    return {
      status: statusCode,
      json: { code, message, cause },
    };
  }
}

export function getMessageByErrorCode(errorCode: ErrorCode): string {
  if (errorCode.includes('database')) {
    return 'An error occurred while executing a database query.';
  }

  switch (errorCode) {
    case 'bad_request:api':
      return "The request couldn't be processed. Please check your input and try again.";

    case 'unauthorized:auth':
      return 'You need to sign in before continuing.';
    case 'forbidden:auth':
      return 'Your account does not have access to this feature.';

    case 'rate_limit:chat':
      return 'You have exceeded your maximum number of messages for the day. Please try again later.';
    case 'not_found:chat':
      return 'The requested chat was not found. Please check the chat ID and try again.';
    case 'forbidden:chat':
      return 'This chat belongs to another user. Please check the chat ID and try again.';
    case 'unauthorized:chat':
      return 'You need to sign in to view this chat. Please sign in and try again.';
    case 'offline:chat':
      return "We're having trouble sending your message. Please check your internet connection and try again.";

    default:
      return 'Something went wrong. Please try again later.';
  }
}

function getStatusCodeByType(type: ErrorType) {
  switch (type) {
    case 'bad_request':
      return 400;
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'rate_limit':
      return 429;
    case 'offline':
      return 503;
    case 'empty':
      return 204;
    default:
      return 500;
  }
}
