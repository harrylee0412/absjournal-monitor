import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuthResult {
  userId: string;
}

interface AuthError {
  error: string;
  status: number;
}

/**
 * Verify API Key from Authorization header.
 * Expected format: "Bearer <userId>:<apiKey>"
 */
export async function verifyApiKey(
  request: Request
): Promise<AuthResult | AuthError> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header', status: 401 };
  }

  const token = authHeader.slice(7);
  const colonIndex = token.indexOf(':');
  if (colonIndex === -1) {
    return { error: 'Invalid token format, expected userId:apiKey', status: 401 };
  }

  const userId = token.slice(0, colonIndex);
  const apiKey = token.slice(colonIndex + 1);

  if (!userId || !apiKey) {
    return { error: 'Missing userId or apiKey', status: 401 };
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings || settings.cronApiKey !== apiKey) {
    return { error: 'Invalid API key', status: 401 };
  }

  return { userId };
}

export function isAuthError(result: AuthResult | AuthError): result is AuthError {
  return 'error' in result;
}
