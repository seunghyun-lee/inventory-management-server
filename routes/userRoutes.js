const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const validRoles = ['관리자', '직원', '조회자', '퇴사', '대기'];

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});

router.get('/', async (req, res) => {
    try {
        const users = await db.query('SELECT id, username, handler_name, role FROM users');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: '사용자 목록을 가져오는데 실패했습니다.' });
    }
});

// 관리자의 새 사용자 추가
router.post('/add', async (req, res) => {
    const { username, handler_name, email, role } = req.body;
    
    try {
        // 사용자명 중복 체크
        const existingUserResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUserResult.length > 0) {
            return res.status(400).json({ error: '이미 존재하는 사용자명입니다.' });
        }

        // 이메일 중복 체크
        const existingEmailResult = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingEmailResult.length > 0) {
            return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
        }

        // 이메일 형식 검사
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
        }

        // 역할 유효성 검사
        if (!validRoles.includes(role)) {
            return res.status(400).json({ error: '유효하지 않은 역할입니다.' });
        }

        // 비밀번호 재설정 토큰 생성
        const resetToken = crypto.randomBytes(20).toString('hex');
        const resetTokenExpires = Date.now() + 3600000; // 1시간 후 만료

        // 임시 비밀번호 생성 (실제 로그인에는 사용되지 않음)
        const tempPassword = await bcrypt.hash(resetToken, 10);

        // 사용자 생성
        const result = await db.query(
            `INSERT INTO users (
                username, 
                password, 
                handler_name, 
                role, 
                email, 
                reset_token, 
                reset_token_expires
            ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [username, tempPassword, handler_name, role, email, resetToken, resetTokenExpires]
        );

        // 비밀번호 설정 이메일 발송
        const resetUrl = `https://inventory-management-client-iota.vercel.app/set-password/${resetToken}`;
        
        const mailOptions = {
            from: process.env.GMAIL_USER,
            to: email,
            subject: '계정 생성 및 비밀번호 설정',
            html: `
                <h1>계정이 생성되었습니다</h1>
                <p>관리자가 귀하의 계정을 생성했습니다.</p>
                <p>아래 링크를 클릭하여 비밀번호를 설정해 주세요:</p>
                <a href="${resetUrl}">${resetUrl}</a>
                <p>이 링크는 1시간 동안 유효합니다.</p>
                <p>링크가 만료된 경우 관리자에게 문의해 주세요.</p>
            `
        };

        try {
            await transporter.sendMail(mailOptions);
            res.status(201).json({ 
                message: '사용자가 생성되었으며, 비밀번호 설정 이메일이 발송되었습니다.',
                userId: result[0].id 
            });
        } catch (emailError) {
            console.error('Error sending email:', emailError);
            if (emailError.code === 'EAUTH') {
                return res.status(500).json({ error: '이메일 인증 오류. 앱 비밀번호를 확인해주세요.' });
            }
            res.status(500).json({ error: '이메일 전송 중 오류가 발생했습니다.' });
        }

    } catch (error) {
        console.error('Error adding new user:', error);
        res.status(500).json({ error: '사용자 추가 중 오류가 발생했습니다.' });
    }
});

// 비밀번호 설정 (최초 설정)
router.post('/set-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    try {
        const user = await db.get(
            'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > $2',
            [token, Date.now()]
        );

        if (!user) {
            return res.status(400).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.run(
            'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
            [hashedPassword, user.id]
        );

        res.json({ message: '비밀번호가 성공적으로 설정되었습니다.' });
    } catch (error) {
        console.error('Error setting password:', error);
        res.status(500).json({ error: '비밀번호 설정 중 오류가 발생했습니다.' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const user = await db.get('SELECT * FROM users WHERE username = $1', [username]);
        
        if (!user) {
            return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: '잘못된 사용자명 또는 비밀번호입니다.' });
        }

        // reset_token이 있고 만료되지 않은 경우에만 비밀번호 설정 요구
        if (user.reset_token && user.reset_token_expires && user.reset_token_expires > Date.now()) {
            return res.status(401).json({ 
                error: '비밀번호를 먼저 설정해주세요. 이메일에서 비밀번호 설정 링크를 확인해주세요.' 
            });
        }

        if (user.role === '퇴사' || user.role === '대기') {
            return res.status(403).json({ error: '권한이 없어서 로그인이 불가능합니다.' });
        }

        const { password: _, reset_token: __, reset_token_expires: ___, ...userWithoutSensitive } = user;
        res.json(userWithoutSensitive);
    } catch (error) {
        console.error('Error in login:', error);
        res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
    }
});

router.put('/:id/role', async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    try {
        // 역할 유효성 검사
        if (!role || !validRoles.includes(role)) {
            return res.status(400).json({ 
                error: '유효하지 않은 역할입니다.',
                details: `역할은 다음 중 하나여야 합니다: ${validRoles.join(', ')}`
            });
        }

        // 사용자 존재 여부 확인
        const userExists = await db.get('SELECT id FROM users WHERE id = $1', [id]);
        if (!userExists) {
            return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
        }

        // 역할 업데이트
        await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
        
        // 성공 응답
        res.json({ 
            message: '사용자 역할이 업데이트되었습니다.',
            role: role
        });
    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ error: '사용자 역할 업데이트에 실패했습니다.' });
    }
});

router.put('/:id/profile', async (req, res) => {
    const { id } = req.params;
    const { username, handler_name, email, currentPassword, newPassword } = req.body;
    
    try {
        const userResult = await db.query('SELECT * FROM users WHERE id = $1', [id]);
        const user = userResult[0];
        if (!user) {
            return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
        }

        const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
        }

        let updateQuery = 'UPDATE users SET ';
        const updateValues = [];
        let paramCount = 1;

        if (username !== user.username) {
            updateQuery += `username = $${paramCount}, `;
            updateValues.push(username);
            paramCount++;
        }

        if (handler_name !== user.handler_name) {
            updateQuery += `handler_name = $${paramCount}, `;
            updateValues.push(handler_name);
            paramCount++;
        }

        if (email !== user.email) {
            // 이메일 중복 체크
            const existingEmailResult = await db.query('SELECT * FROM users WHERE email = $1 AND id != $2', [email, id]);
            if (existingEmailResult.length > 0) {
                return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
            }

            // 이메일 형식 검사
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
            }

            updateQuery += `email = $${paramCount}, `;
            updateValues.push(email);
            paramCount++;
        }

        if (newPassword) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            updateQuery += `password = $${paramCount}, `;
            updateValues.push(hashedPassword);
            paramCount++;
        }

        // Remove trailing comma and space
        updateQuery = updateQuery.slice(0, -2);

        if (updateValues.length > 0) {
            updateQuery += ` WHERE id = $${paramCount}`;
            updateValues.push(id);
            await db.query(updateQuery, updateValues);
        }

        const updatedUserResult = await db.query('SELECT id, username, handler_name, role, email FROM users WHERE id = $1', [id]);
        const updatedUser = updatedUserResult[0];

        res.json(updatedUser);
    } catch (error) {
        console.log('Error updating user:', error);
        res.status(500).json({ error: '사용자 정보 업데이트 중 오류가 발생했습니다.' });
    }
});

router.post('/signup', async (req, res) => {
    const { username, password, handler_name, email } = req.body;
    try {
        // 사용자명 중복 체크
        const existingUserResult = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (existingUserResult.length > 0) {
            return res.status(400).json({ error: '이미 존재하는 사용자명입니다.' });
        }

        // 이메일 중복 체크
        const existingEmailResult = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingEmailResult.length > 0) {
            return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
        }

        // 이메일 형식 검사
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: '올바른 이메일 형식이 아닙니다.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await db.query(
            'INSERT INTO users (username, password, handler_name, role, email) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [username, hashedPassword, handler_name, '대기', email]
        );
        res.status(201).json({ message: '회원가입이 완료되었습니다.', userId: result[0].id });
    } catch (error) {
        console.log('Error in signup:', error);
        res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
    }
});

module.exports = router;