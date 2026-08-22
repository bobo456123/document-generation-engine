import pino, { type DestinationStream, type Logger } from 'pino';

export function createLogger(destination?: DestinationStream): Logger {
  const options = {
    redact: {
      paths: ['appId', 'appSecret', 'secret', 'token', 'accessToken', 'authorization', '*.appId', '*.appSecret', '*.secret', '*.token', '*.accessToken', '*.authorization', 'headers.authorization', 'req.headers.authorization'],
      censor: '[REDACTED]'
    }
  };
  return destination ? pino(options, destination) : pino(options);
}
