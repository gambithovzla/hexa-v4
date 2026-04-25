import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendVerificationEmail(email, code) {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set - skipping email, code:', code);
    return false;
  }
  try {
    await resend.emails.send({
      from: 'H.E.X.A. Oracle <noreply@hexaoracle.lat>',
      to: email,
      subject: 'Your H.E.X.A. verification code',
      html: `
        <div style="font-family:monospace;background:#0a0e1a;color:#00D9FF;padding:30px;text-align:center;">
          <h2 style="color:#FF6600;">H.E.X.A. ORACLE</h2>
          <p style="color:#E8F4FF;">Your verification code:</p>
          <h1 style="color:#00FF88;font-size:36px;letter-spacing:8px;">${code}</h1>
          <p style="color:#E8F4FF;font-size:12px;">This code expires in 15 minutes.</p>
          <p style="color:rgba(0,217,255,0.5);font-size:10px;">Gambitho Labs - hexaoracle.lat</p>
        </div>
      `,
    });
    console.log(`[email] Verification sent to ${email}`);
    return true;
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    return false;
  }
}

export async function sendPasswordResetEmail(email, code) {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set - skipping password reset email, code:', code);
    return false;
  }
  try {
    await resend.emails.send({
      from: 'H.E.X.A. Oracle <noreply@hexaoracle.lat>',
      to: email,
      subject: 'Reset your H.E.X.A. password',
      html: `
        <div style="font-family:monospace;background:#0a0e1a;color:#00D9FF;padding:30px;text-align:center;">
          <h2 style="color:#FF6600;">H.E.X.A. ORACLE</h2>
          <p style="color:#E8F4FF;">Use this code to reset your password:</p>
          <h1 style="color:#00FF88;font-size:36px;letter-spacing:8px;">${code}</h1>
          <p style="color:#E8F4FF;font-size:12px;">This code expires in 15 minutes.</p>
          <p style="color:rgba(0,217,255,0.5);font-size:10px;">If you did not request this, you can ignore this email.</p>
          <p style="color:rgba(0,217,255,0.5);font-size:10px;">Gambitho Labs - hexaoracle.lat</p>
        </div>
      `,
    });
    console.log(`[email] Password reset sent to ${email}`);
    return true;
  } catch (err) {
    console.error('[email] Password reset send failed:', err.message);
    return false;
  }
}
