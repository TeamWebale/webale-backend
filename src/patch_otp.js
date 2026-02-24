/**
 * patch_otp.js — run on Render shell:
 *   node /tmp/patch_otp.js
 *
 * Adds to authController.js:
 *   1. sendOtp()  — generates 6-digit OTP, saves to DB, emails via Resend
 *   2. verifyOtp() — checks OTP, marks user as verified, returns token
 *   3. Modifies register() — saves user as unverified, calls sendOtp
 */
import { readFileSync, writeFileSync } from 'fs';

const path = '/opt/render/project/src/src/controllers/authController.js';
let content = readFileSync(path, 'utf8');

// ── 1. Add Resend import at top ──────────────────────────────────
if (!content.includes("from 'resend'")) {
  content = content.replace(
    "import pool from '../config/database.js';",
    "import pool from '../config/database.js';\nimport { Resend } from 'resend';\nconst resend = new Resend(process.env.RESEND_API_KEY);"
  );
}

// ── 2. Add sendOtp + verifyOtp exports at end of file ────────────
const newExports = `

// ── Send / Resend OTP ─────────────────────────────────────────────
export const sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    const userRes = await pool.query('SELECT id, first_name FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0)
      return res.status(404).json({ success: false, message: 'User not found' });

    const user = userRes.rows[0];
    const otp  = Math.floor(100000 + Math.random() * 900000).toString();
    const exp  = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await pool.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
      [otp, exp, user.id]
    );

    await resend.emails.send({
      from: 'Webale <noreply@webale.net>',
      to:   email,
      subject: 'Your Webale verification code',
      html: \`
        <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#0D1B2E;padding:32px;border-radius:16px;">
          <div style="text-align:center;margin-bottom:24px;">
            <h1 style="color:#00E5CC;font-size:28px;margin:0;">Webale!</h1>
            <p style="color:#FFB800;margin:4px 0 0;font-size:13px;">Private Group Fundraising</p>
          </div>
          <p style="color:#ffffff;font-size:16px;">Hi \${user.first_name || 'there'},</p>
          <p style="color:rgba(255,255,255,0.7);font-size:14px;">Your verification code is:</p>
          <div style="text-align:center;margin:24px 0;">
            <span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#00E5CC;background:rgba(0,229,204,0.1);padding:16px 24px;border-radius:12px;display:inline-block;">
              \${otp}
            </span>
          </div>
          <p style="color:rgba(255,255,255,0.5);font-size:12px;text-align:center;">
            This code expires in <strong style="color:#FFB800;">15 minutes</strong>.<br>
            If you didn't create a Webale account, ignore this email.
          </p>
          <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
          <p style="color:rgba(255,255,255,0.3);font-size:11px;text-align:center;">
            © 2026 Landfolks Aitech (U) Ltd · theteam@webale.net
          </p>
        </div>
      \`,
    });

    res.json({ success: true, message: 'OTP sent to ' + email });
  } catch (error) {
    console.error('sendOtp error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

// ── Verify OTP ────────────────────────────────────────────────────
export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ success: false, message: 'Email and OTP required' });

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'User not found' });

    const user = result.rows[0];

    if (!user.otp_code || user.otp_code !== otp)
      return res.status(400).json({ success: false, message: 'Invalid verification code' });

    if (new Date() > new Date(user.otp_expires_at))
      return res.status(400).json({ success: false, message: 'Code expired — request a new one' });

    // Mark verified, clear OTP
    await pool.query(
      'UPDATE users SET is_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE id = $1',
      [user.id]
    );

    // Generate JWT
    import jwt from 'jsonwebtoken';
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          country: user.country,
          avatar_url: user.avatar_url,
          avatar_type: user.avatar_type,
          created_at: user.created_at,
          is_verified: true,
        }
      }
    });
  } catch (error) {
    console.error('verifyOtp error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
};
`;

if (!content.includes('export const sendOtp')) {
  content = content + newExports;
}

// ── 3. Modify register() to NOT auto-login, instead send OTP ─────
// After successful INSERT, replace the JWT + login response with sendOtp call
content = content.replace(
  `// Generate JWT token
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          first_name: newUser.first_name,
          last_name: newUser.last_name,
          country: newUser.country,
          avatar_url: newUser.avatar_url,
          created_at: newUser.created_at
        }
      }
    });`,
  `// Send OTP for email verification (don't issue token yet)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const exp = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
      [otp, exp, newUser.id]
    );
    await resend.emails.send({
      from: 'Webale <noreply@webale.net>',
      to: newUser.email,
      subject: 'Your Webale verification code',
      html: \`<div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#0D1B2E;padding:32px;border-radius:16px;"><div style="text-align:center;margin-bottom:24px;"><h1 style="color:#00E5CC;font-size:28px;margin:0;">Webale!</h1><p style="color:#FFB800;margin:4px 0 0;font-size:13px;">Private Group Fundraising</p></div><p style="color:#ffffff;font-size:16px;">Hi \${newUser.first_name || 'there'},</p><p style="color:rgba(255,255,255,0.7);font-size:14px;">Your verification code is:</p><div style="text-align:center;margin:24px 0;"><span style="font-size:42px;font-weight:800;letter-spacing:12px;color:#00E5CC;background:rgba(0,229,204,0.1);padding:16px 24px;border-radius:12px;display:inline-block;">\${otp}</span></div><p style="color:rgba(255,255,255,0.5);font-size:12px;text-align:center;">This code expires in <strong style="color:#FFB800;">15 minutes</strong>.</p><hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;"><p style="color:rgba(255,255,255,0.3);font-size:11px;text-align:center;">© 2026 Landfolks Aitech (U) Ltd · theteam@webale.net</p></div>\`,
    });
    res.status(201).json({
      success: true,
      message: 'OTP sent',
      data: { email: newUser.email, requiresVerification: true }
    });`
);

writeFileSync(path, content);
console.log('✅ authController.js patched');
console.log('  Resend imported:', content.includes("from 'resend'"));
console.log('  sendOtp exported:', content.includes('export const sendOtp'));
console.log('  verifyOtp exported:', content.includes('export const verifyOtp'));
console.log('  register sends OTP:', content.includes('requiresVerification: true'));
"// OTP routes added" 
