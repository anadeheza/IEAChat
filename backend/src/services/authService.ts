import * as nodemailer from 'nodemailer';
import prisma from '../prismaClient';

let cachedTransporter: nodemailer.Transporter | null = null;

async function getTransporter(): Promise<nodemailer.Transporter> {
    if (cachedTransporter) return cachedTransporter;

    const host = process.env.MAIL_HOST || '127.0.0.1';
    const port = Number(process.env.MAIL_PORT || 1025);
    const user = process.env.MAIL_USER || '';
    const pass = process.env.MAIL_PASS || '';

    // If defaults or placeholders are present, fall back to Ethereal (test) account.
    const isPlaceholderHost = host.includes('example') || host === 'smtp.example.com';
    const isPlaceholderUser = user.startsWith('your') || user === '';

    if (isPlaceholderHost || isPlaceholderUser) {
        try {
            const testAccount = await nodemailer.createTestAccount();
            cachedTransporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass,
                },
            });
            console.warn('⚠️  SMTP appears unconfigured — using Ethereal test account for email delivery.');
            return cachedTransporter;
        } catch (err) {
            console.error('Failed to create Ethereal test account:', err);
            // continue to try creating a normal transporter below
        }
    }

    cachedTransporter = nodemailer.createTransport({
        host,
        port,
        secure: process.env.MAIL_SECURE === 'true',
        auth: user && pass ? { user, pass } : undefined,
        ignoreTLS: process.env.MAIL_IGNORE_TLS === 'true' || false,
        tls: process.env.MAIL_TLS_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
    });

    try {
        await cachedTransporter.verify();
        console.log(`✅ SMTP transporter verified (${host}:${port})`);
    } catch (err: any) {
        console.warn('⚠️ SMTP transporter verification failed:', err && err.message ? err.message : err);
    }

    return cachedTransporter;
}

function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

interface OtpEntry {
    code: string;
    expiresAt: Date;
}
 
const otpStore = new Map<string, OtpEntry>();
 
const OTP_TTL_MINUTES = 10;
 
export async function sendVerificationCode(email: string): Promise<void> {
    // Verificar que el usuario existe en la BD
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        console.log(`⚠️  Email no encontrado en BD: "${email}"`);  

        // No revelamos si el email existe o no (seguridad)
        // Igual retornamos sin error para no filtrar info
        return;
    }
    console.log(`✅ Enviando código a: ${email}`);
 
    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
 
    // Guardar (o reemplazar) el OTP en memoria
    otpStore.set(email, { code, expiresAt });
 
    const mailRecipient = process.env.MAIL_OVERRIDE_RECIPIENT?.trim() || email;
    if (process.env.MAIL_OVERRIDE_RECIPIENT && process.env.MAIL_OVERRIDE_RECIPIENT.trim() !== email) {
        console.log(`📬 Override de email activado: todos los mensajes se envían a ${mailRecipient}`);
    }
 
    try {
        const transporter = await getTransporter();
        const info = await transporter.sendMail({
            from: process.env.MAIL_FROM || '"Flock App" <no-reply@flock.local>',
            to: mailRecipient,
            subject: 'Tu código de verificación',
            text: `Tu código de verificación es: ${code}\n\nExpira en ${OTP_TTL_MINUTES} minutos.`,
            html: `
                <div style="font-family: sans-serif; max-width: 400px; margin: auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px;">
                    <h2 style="color: #1a202c; margin-bottom: 8px;">Código de verificación</h2>
                    <p style="color: #4a5568;">Ingresá el siguiente código para iniciar sesión:</p>
                    <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2b6cb0; margin: 24px 0;">
                        ${code}
                    </div>
                    <p style="color: #718096; font-size: 14px; display: flex; justify-content: center;">El código expira en ${OTP_TTL_MINUTES} minutos. Si no solicitaste este código, ignorá este mensaje.</p>
                </div>
            `,
        });

        // If using Ethereal, print preview URL to console to help local debugging
        const preview = nodemailer.getTestMessageUrl(info);
        if (preview) console.log(`📨 Email enviado (Ethereal preview): ${preview}`);
        else console.log(`📨 Email enviado: ${info.messageId}`);
    } catch (mailError: any) {
        console.error('Error enviando OTP por email:', mailError && mailError.message ? mailError.message : mailError);
        // Keep silent to the client to avoid leaking information about account existence
    }
}

export function verifyCode(email: string, inputCode: string): boolean {
    const entry = otpStore.get(email);
 
    if (!entry) return false;
    if (new Date() > entry.expiresAt) {
        otpStore.delete(email);
        return false;
    }
    if (entry.code !== inputCode) return false;
 
    // Código correcto → eliminarlo para que no se pueda reusar
    otpStore.delete(email);
    return true;
}
 