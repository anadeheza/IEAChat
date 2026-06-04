import { RequestHandler } from 'express';
import { sendVerificationCode, verifyCode } from '../services/authService';
import prisma from '../prismaClient';

export const login: RequestHandler = async (req, res) => {
    try {
        const { email } = req.body;
 
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ message: 'Ingrese un email valido.' });
        }
 
        await sendVerificationCode(email.trim().toLowerCase());
 
        // Siempre respondemos con el mismo mensaje para no filtrar si el usuario existe
        return res.json({
            message: 'Si el email está registrado, recibirás un código de verificación.',
        });
    } catch (error) {
        console.error('Error en login:', error);
        return res.status(500).json({ message: 'Error interno del servidor.', error: String(error) });
    }
};

export const verify: RequestHandler = async (req, res) => {
   
    try {
        const { email, code } = req.body;

        if (!email || !code || typeof email !== 'string' || typeof code !== 'string') {
            return res.status(400).json({ message: 'Email y código son requeridos.' });
        }
 
        const isValid = verifyCode(email.trim().toLowerCase(), code.trim());
 
        if (!isValid) {
            return res.status(401).json({ message: 'Código inválido o expirado.' });
        }
 
        // Código correcto: buscamos el usuario para devolverlo al frontend
        const user = await prisma.user.findUnique({
            where: { email: email.trim().toLowerCase() },
            select: { id: true, name: true, email: true },
        });
 
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }
 
        return res.json({
            message: 'Verificación exitosa.',
            user,
        });
    } catch (error) {
        console.error('Error en verify:', error);
        return res.status(500).json({ message: 'Error interno del servidor.', error: String(error) });
    }
};
 