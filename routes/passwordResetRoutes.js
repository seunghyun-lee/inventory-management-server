const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

router.post('/reset-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await db.get('SELECT * FROM users WHERE email = $1', [email]);
        if (!user) {
            return res.status(404).json({ message: '해당 이메일로 등록된 사용자를 찾을 수 없습니다.' });
        }

        const resetToken = crypto.randomBytes(20).toString('hex');
        const resetTokenExpires = Date.now() + 3600000; // 1시간 후 만료

        await db.run('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', 
            [resetToken, resetTokenExpires, user.id]);

        const resetUrl = `https://inventory-management-client-iota.vercel.app/reset-password/${resetToken}`;

        // 이메일 옵션 설정
        const mailOptions = {
            from: process.env.GMAIL_USER,
            to: user.email,
            subject: '비밀번호 재설정',
            text: `비밀번호를 재설정하려면 다음 링크를 클릭하세요: ${resetUrl}`
        };

        // 이메일 전송
        try {
            await transporter.sendMail(mailOptions);
            res.json({ message: '비밀번호 재설정 링크가 이메일로 전송되었습니다.' });
        } catch (emailError) {
            console.error('Error sending email:', emailError);
            if (emailError.code === 'EAUTH') {
                return res.status(500).json({ message: '이메일 인증 오류. 앱 비밀번호를 확인해주세요.' });
            }
            res.status(500).json({ message: '이메일 전송 중 오류가 발생했습니다.' });
        }

    } catch (error) {
        console.error('Error in password reset request:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

router.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;
    try {
        const user = await db.get('SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > $2', 
            [token, Date.now()]);
        if (!user) {
            return res.status(400).json({ message: '유효하지 않거나 만료된 토큰입니다.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.run('UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
            [hashedPassword, user.id]);

        res.json({ message: '비밀번호가 성공적으로 재설정되었습니다.' });
    } catch (error) {
        console.error('Error in password reset:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

module.exports = router;