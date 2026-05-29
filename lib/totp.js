import { authenticator } from 'otplib'

authenticator.options = { window: 1 } // allow 1 period tolerance

export function generateSecret() {
  return authenticator.generateSecret(32)
}

export function verifyToken(token, secret) {
  return authenticator.verify({ token, secret })
}

export function getOtpAuthUrl(email, secret) {
  return authenticator.keyuri(email, 'SplashPass Admin', secret)
}
