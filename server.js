const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const { createServer } = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["https://www.centrodecompra.com.br", "http://localhost:3000"],
        methods: ["GET", "POST", "PUT", "DELETE"],
    }
});

// Configuração do CORS
app.use(cors({
    origin: ["https://www.centrodecompra.com.br", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"]
}));
app.use(express.json());

// Configuração do Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuração do PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Conectar ao banco e criar a tabela
pool.connect()
    .then(() => {
        console.log('Conectado ao PostgreSQL');
        return pool.query(`
            CREATE TABLE IF NOT EXISTS produtos (
                id SERIAL PRIMARY KEY,
                nome VARCHAR(255) NOT NULL,
                preco NUMERIC DEFAULT 0,
                preco_com_desconto NUMERIC,
                imagens TEXT[],
                categoria VARCHAR(50),
                loja VARCHAR(50),
                link TEXT,
                avaliacao NUMERIC DEFAULT 0,
                numero_avaliacoes INTEGER DEFAULT 0,
                CHECK (LENGTH(nome) <= 255),
                CHECK (link ~ '^https?://')
            );
        `);
    })
    .then(() => console.log('Tabela produtos criada ou verificada'))
    .catch(err => console.error('Erro ao conectar ou criar tabela:', err));

// Listas de validação
const CATEGORIAS_PERMITIDAS = ['todas', 'pet', 'eletronicos', 'moda', 'fitness', 'casa', 'beleza', 'esportes', 'livros', 'infantil', 'Celulares', 'Eletrodomésticos'];
const LOJAS_PERMITIDAS = ['todas', 'amazon', 'shein', 'shopee', 'magalu', 'mercadolivre', 'alibaba'];

// Rotas
app.get('/api/produtos', async (req, res) => {
    try {
        const { page = 1, limit = 10, categoria, loja } = req.query;
        const offset = (page - 1) * limit;
        let query = 'SELECT * FROM produtos';
        let countQuery = 'SELECT COUNT(*) FROM produtos';
        const values = [];
        const conditions = [];

        if (categoria && categoria !== 'todas') {
            conditions.push(`categoria = $${values.length + 1}`);
            values.push(categoria);
        }
        if (loja && loja !== 'todas') {
            conditions.push(`loja = $${values.length + 1}`);
            values.push(loja);
        }
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
            countQuery += ` WHERE ${conditions.join(' AND ')}`;
        }

        query += ` ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
        values.push(limit, offset);

        console.log('Executando query:', query, values);
        const { rows } = await pool.query(query, values);
        const { rows: countRows } = await pool.query(countQuery, values.slice(0, -2));
        const total = parseInt(countRows[0].count);

        res.json({ status: 'success', data: rows, total });
    } catch (error) {
        console.error('Erro ao listar produtos:', error.message, error.stack);
        res.status(500).json({ status: 'error', message: `Erro ao listar produtos: ${error.message}` });
    }
});

app.get('/api/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
        }
        res.json({ status: 'success', data: rows[0] });
    } catch (error) {
        console.error('Erro ao buscar produto:', error.message, error.stack);
        res.status(500).json({ status: 'error', message: `Erro ao buscar produto: ${error.message}` });
    }
});

app.post('/api/produtos', upload.array('imagens', 5), async (req, res) => {
    try {
        const { nome, categoria, loja, link, preco = 0 } = req.body;
        const imagens = req.files;
        console.log('Dados recebidos:', { nome, categoria, loja, link, preco, imagensCount: imagens?.length, imagens: imagens?.map(f => f.originalname) });

        // Validações
        if (!nome || !categoria || !loja || !imagens || imagens.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Campos obrigatórios ausentes, incluindo pelo menos uma imagem' });
        }
        if (!CATEGORIAS_PERMITIDAS.includes(categoria)) {
            return res.status(400).json({ status: 'error', message: `Categoria inválida: ${categoria}` });
        }
        if (!LOJAS_PERMITIDAS.includes(loja)) {
            return res.status(400).json({ status: 'error', message: `Loja inválida: ${loja}` });
        }
        if (!link.match(/^https?:\/\//)) {
            return res.status(400).json({ status: 'error', message: 'Link inválido, deve começar com http:// ou https://' });
        }
        if (nome.length > 255) {
            return res.status(400).json({ status: 'error', message: 'Nome do produto excede 255 caracteres' });
        }
        if (isNaN(preco) || preco < 0) {
            return res.status(400).json({ status: 'error', message: 'Preço inválido, deve ser um número não negativo' });
        }

        console.log('Iniciando upload para o Cloudinary');
        const imageUrls = [];
        for (const file of imagens) {
            try {
                console.log('Fazendo upload de imagem:', file.originalname, file.mimetype, file.size);
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
                console.log('Upload bem-sucedido:', result.secure_url);
                imageUrls.push(result.secure_url);
            } catch (uploadError) {
                console.error('Erro ao fazer upload da imagem para o Cloudinary:', uploadError.message, uploadError.stack);
                return res.status(500).json({ status: 'error', message: `Erro ao fazer upload da imagem: ${uploadError.message}` });
            }
        }

        console.log('Inserindo no PostgreSQL:', { nome, categoria, loja, imageUrls, link, preco });
        const query = `
            INSERT INTO produtos (nome, categoria, loja, imagens, link, preco)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`;
        const values = [nome, categoria, loja, imageUrls, link, preco];
        const { rows } = await pool.query(query, values);
        console.log('Produto inserido:', rows[0]);

        io.emit('novoProduto', rows[0]);
        res.status(201).json({ status: 'success', message: 'Produto cadastrado com sucesso', data: rows[0] });
    } catch (error) {
        console.error('Erro ao cadastrar produto:', error.message, error.stack);
        res.status(500).json({ status: 'error', message: `Erro ao cadastrar produto: ${error.message}` });
    }
});

app.put('/api/produtos/:id', upload.array('imagens', 5), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, categoria, loja, link, preco = 0 } = req.body;
        const imagens = req.files;
        console.log('Dados recebidos para atualização:', { id, nome, categoria, loja, link, preco, imagensCount: imagens?.length });

        if (!nome || !categoria || !loja) {
            return res.status(400).json({ status: 'error', message: 'Campos obrigatórios ausentes' });
        }
        if (!CATEGORIAS_PERMITIDAS.includes(categoria)) {
            return res.status(400).json({ status: 'error', message: `Categoria inválida: ${categoria}` });
        }
        if (!LOJAS_PERMITIDAS.includes(loja)) {
            return res.status(400).json({ status: 'error', message: `Loja inválida: ${loja}` });
        }
        if (!link.match(/^https?:\/\//)) {
            return res.status(400).json({ status: 'error', message: 'Link inválido, deve começar com http:// ou https://' });
        }
        if (nome.length > 255) {
            return res.status(400).json({ status: 'error', message: 'Nome do produto excede 255 caracteres' });
        }
        if (isNaN(preco) || preco < 0) {
            return res.status(400).json({ status: 'error', message: 'Preço inválido, deve ser um número não negativo' });
        }

        const imageUrls = [];
        if (imagens && imagens.length > 0) {
            console.log('Iniciando upload para o Cloudinary');
            for (const file of imagens) {
                try {
                    console.log('Fazendo upload de imagem:', file.originalname, file.mimetype, file.size);
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
                    console.log('Upload bem-sucedido:', result.secure_url);
                    imageUrls.push(result.secure_url);
                } catch (uploadError) {
                    console.error('Erro ao fazer upload da imagem para o Cloudinary:', uploadError.message, uploadError.stack);
                    return res.status(500).json({ status: 'error', message: `Erro ao fazer upload da imagem: ${uploadError.message}` });
                }
            }
        }

        console.log('Atualizando no PostgreSQL:', { id, nome, categoria, loja, link, preco, imageUrls });
        const query = `
            UPDATE produtos 
            SET nome = $1, categoria = $2, loja = $3, imagens = COALESCE($4, imagens), link = $5, preco = $6
            WHERE id = $7
            RETURNING *`;
        const values = [nome, categoria, loja, imageUrls.length > 0 ? imageUrls : null, link, preco, id];
        const { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
        }

        io.emit('produtoAtualizado', rows[0]);
        res.json({ status: 'success', message: 'Produto atualizado com sucesso', data: rows[0] });
    } catch (error) {
        console.error('Erro ao atualizar produto:', error.message, error.stack);
        res.status(500).json({ status: 'error', message: `Erro ao atualizar produto: ${error.message}` });
    }
});

app.delete('/api/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('Excluindo produto:', id);
        const { rows } = await pool.query('DELETE FROM produtos WHERE id = $1 RETURNING *', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Produto não encontrado' });
        }
        io.emit('produtoExcluido', rows[0]);
        res.json({ status: 'success', message: 'Produto excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir produto:', error.message, error.stack);
        res.status(500).json({ status: 'error', message: `Erro ao excluir produto: ${error.message}` });
    }
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Novo cliente conectado:', socket.id);
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
