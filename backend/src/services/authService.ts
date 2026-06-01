import * as nodemailer from 'nodemailer';
import prisma from '../prismaClient';

const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || '127.0.0.1',
    port: Number(process.env.MAIL_PORT || 1025),
    secure: process.env.MAIL_SECURE === 'true',
    auth: process.env.MAIL_USER && process.env.MAIL_PASS ? {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
    } : undefined,
    ignoreTLS: process.env.MAIL_IGNORE_TLS === 'true' || false,
    tls: process.env.MAIL_TLS_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
});

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
        await transporter.sendMail({
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
    } catch (mailError) {
        console.error('Error enviando OTP por email:', mailError);
        // No lanzamos el error para no filtrar si el email existe
        // -> el flujo de login sigue, pero el envío puede fallar si SMTP no está configurado.
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
 