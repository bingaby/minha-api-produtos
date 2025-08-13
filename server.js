const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Configuração do CORS
const allowedOrigins = [
    'http://localhost:8080',
    'https://www.centrodecompra.com.br',
    'https://minha-api-produtos.onrender.com',
    // Adicione o domínio do frontend hospedado (ex.: https://seu-frontend.netlify.app)
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
}));
app.use(express.json());

// Middleware de autenticação
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
    console.log('Cabeçalho Authorization recebido:', authHeader);
    console.log('ADMIN_TOKEN esperado:', `Bearer ${ADMIN_TOKEN}`);
    if (!authHeader || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
        return res.status(401).json({ status: 'error', message: 'Autenticação necessária' });
    }
    next();
};

// Configuração do banco de dados
const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT,
    ssl: { rejectUnauthorized: false },
});

// Criar tabela produtos se não existir
pool.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao PostgreSQL:', err);
        process.exit(1);
    }
    console.log('Conectado ao PostgreSQL');
    pool.query(`
        CREATE TABLE IF NOT EXISTS produtos (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL CHECK (LENGTH(nome) <= 255),
            categoria TEXT NOT NULL,
            loja TEXT NOT NULL,
            imagens TEXT[] NOT NULL,
            link TEXT NOT NULL CHECK (link ~ '^https?://'),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `, (err) => {
        if (err) {
            console.error('Erro ao criar tabela produtos:', err);
            process.exit(1);
        }
        console.log('Tabela produtos criada ou verificada');
    });
});

// Configuração do Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configuração do Socket.IO
const server = require('http').createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
});

io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Lista de categorias e lojas permitidas (alinhada com o frontend)
const CATEGORIAS_PERMITIDAS = [
    'eletronicos', 'moda', 'fitness', 'casa', 'beleza', 'esportes', 'livros',
    'infantil', 'Celulares', 'Eletrodomésticos', 'pet', 'jardinagem', 'automotivo',
    'gastronomia', 'games'
];
const LOJAS_PERMITIDAS = ['amazon', 'magalu', 'shein', 'shopee', 'mercadolivre', 'alibaba'];

// Rota para buscar produto por ID
app.get('/api/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = 'SELECT * FROM produtos WHERE id = $1';
        const { rows } = await pool.query(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
        }

        res.json({ status: 'success', data: rows[0] });
    } catch (error) {
        console.error('Erro ao buscar produto:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao buscar produto' });
    }
});

// Rota para listar produtos
app.get('/api/produtos', async (req, res) => {
    try {
        const { categoria, loja, page = 1, limit = 24 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        if (categoria && categoria !== 'todas' && !CATEGORIAS_PERMITIDAS.includes(categoria)) {
            return res.status(400).json({ status: 'error', message: 'Categoria inválida' });
        }
        if (loja && loja !== 'todas' && !LOJAS_PERMITIDAS.includes(loja)) {
            return res.status(400).json({ status: 'error', message: 'Loja inválida' });
        }

        let query = 'SELECT * FROM produtos';
        const values = [];
        let whereClauses = [];

        if (categoria && categoria !== 'todas') {
            whereClauses.push('categoria = $' + (values.length + 1));
            values.push(categoria);
        }
        if (loja && loja !== 'todas') {
            whereClauses.push('loja = $' + (values.length + 1));
            values.push(loja);
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        const countQuery = `SELECT COUNT(*) FROM produtos${whereClauses.length > 0 ? ' WHERE ' + whereClauses.join(' AND ') : ''}`;
        const countResult = await pool.query(countQuery, values.slice(0, whereClauses.length));

        query += ' ORDER BY id DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
        values.push(limit, offset);

        const { rows } = await pool.query(query, values);

        res.json({
            status: 'success',
            data: rows,
            total: parseInt(countResult.rows[0].count),
        });
    } catch (error) {
        console.error('Erro ao listar produtos:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao listar produtos' });
    }
});

// Rota para cadastrar produto
app.post('/api/produtos', authenticate, upload.array('imagens', 5), async (req, res) => {
    try {
        const { nome, categoria, loja, link } = req.body;
        const imagens = req.files;

        if (!nome || !categoria || !loja || !imagens || imagens.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Campos obrigatórios ausentes, incluindo pelo menos uma imagem' });
        }

        if (!CATEGORIAS_PERMITIDAS.includes(categoria)) {
            return res.status(400).json({ status: 'error', message: 'Categoria inválida' });
        }
        if (!LOJAS_PERMITIDAS.includes(loja)) {
            return res.status(400).json({ status: 'error', message: 'Loja inválida' });
        }
        if (!link.match(/^https?:\/\//)) {
            return res.status(400).json({ status: 'error', message: 'Link inválido' });
        }

        const imageUrls = [];
        for (const file of imagens) {
            const result = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { transformation: [{ width: 300, height: 300, crop: 'limit' }] },
                    (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    }
                );
                uploadStream.end(file.buffer);
            });
            imageUrls.push(result.secure_url);
        }

        const query = `
            INSERT INTO produtos (nome, categoria, loja, imagens, link)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *`;
        const values = [nome, categoria, loja, imageUrls, link];
        const { rows } = await pool.query(query, values);

        io.emit('novoProduto', rows[0]);
        res.status(201).json({ status: 'success', message: 'Produto cadastrado com sucesso', data: rows[0] });
    } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao cadastrar produto' });
    }
});

// Rota para atualizar produto
app.put('/api/produtos/:id', authenticate, upload.array('imagens', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, categoria, loja, link } = req.body;
        const imagens = req.files;

        if (!nome || !categoria || !loja) {
            return res.status(400).json({ status: 'error', message: 'Campos obrigatórios ausentes' });
        }

        if (!CATEGORIAS_PERMITIDAS.includes(categoria)) {
            return res.status(400).json({ status: 'error', message: 'Categoria inválida' });
        }
        if (!LOJAS_PERMITIDAS.includes(loja)) {
            return res.status(400).json({ status: 'error', message: 'Loja inválida' });
        }
        if (!link.match(/^https?:\/\//)) {
            return res.status(400).json({ status: 'error', message: 'Link inválido' });
        }

        const imageUrls = [];
        if (imagens && imagens.length > 0) {
            for (const file of imagens) {
                const result = await new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        { transformation: [{ width: 300, height: 300, crop: 'limit' }] },
                        (error, result) => {
                            if (error) reject(error);
                            else resolve(result);
                        }
                    );
                    uploadStream.end(file.buffer);
                });
                imageUrls.push(result.secure_url);
            }
        }

        const query = `
            UPDATE produtos
            SET nome = $1, categoria = $2, loja = $3, imagens = $4, link = $5
            WHERE id = $6
            RETURNING *`;
        const values = [
            nome,
            categoria,
            loja,
            imageUrls.length > 0 ? imageUrls : (await pool.query('SELECT imagens FROM produtos WHERE id = $1', [id])).rows[0]?.imagens || [],
            link,
            id
        ];
        const { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
        }

        io.emit('produtoAtualizado', rows[0]);
        res.json({ status: 'success', message: 'Produto atualizado com sucesso', data: rows[0] });
    } catch (error) {
        console.error('Erro ao atualizar produto:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao atualizar produto' });
    }
});

// Rota para excluir produto
app.delete('/api/produtos/:id', authenticate, async (req, res) => {
    try {
        const { id } = req.params;
        const query = 'DELETE FROM produtos WHERE id = $1 RETURNING *';
        const { rows } = await pool.query(query, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
        }

        io.emit('produtoExcluido', { id });
        res.json({ status: 'success', message: 'Produto excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir produto:', error);
        res.status(500).json({ status: 'error', message: 'Erro ao excluir produto' });
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
