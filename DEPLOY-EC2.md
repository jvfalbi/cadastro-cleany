# Passo a passo — subir o Cleany na AWS EC2

Use este arquivo como roteiro único. O app é **Node + Express + SQLite**; precisa de uma **máquina virtual (EC2)** ligada o tempo todo.

---

## Antes de começar

- Conta na [AWS](https://aws.amazon.com).
- Ter o projeto no **GitHub/GitLab** **ou** a pasta no seu PC para enviar por `scp`.
- Anotar: você vai precisar do **IP público** da instância e do arquivo **`.pem`** da chave.

---

## Login e arquivo `.env` (leia isto)

- O **`.env`** fica na **raiz do projeto** (ao lado de `package.json`), **nunca** só dentro de `src/`.
- Em **produção** o Node sobe com `NODE_ENV=production` (é o que o `ecosystem.config.cjs` do PM2 usa). Nesse modo o app **não inicia** sem no `.env`:
  - **`LOGIN_USER`** e **`LOGIN_PASSWORD`**
  - **`SESSION_SECRET`** com **pelo menos 16 caracteres**
- O servidor carrega o `.env` por **caminho fixo**; não depende da “pasta atual” do PM2.
- Nos logs (`pm2 logs`) aparece **`[Cleany] .env OK:`** ou mensagem de erro se o arquivo sumir.
- No **PC, para desenvolvimento**, sem `LOGIN_*` no `.env`: o login padrão está em **`src/server.js`** (`DEV_LOGIN_USER` / `DEV_LOGIN_PASSWORD`). Para outro usuário local, defina `LOGIN_USER` e `LOGIN_PASSWORD` no `.env`.

### Atualizar o `server.js` do PC → EC2 (PowerShell)

Na raiz do projeto:

```powershell
.\scripts\upload-to-ec2.ps1
```

Informe o caminho do `.pem` e `ec2-user@SEU_IP`. Depois, no SSH:

`cd ~/cadastro-cleany && npm install --omit=dev && pm2 restart cadastro-cleany`

---

## Parte A — Criar a instância EC2 (console AWS)

1. Entre no **Console AWS** → serviço **EC2** → **Instâncias** → **Executar instâncias** (Launch instance).

2. **Nome**: por exemplo `cleany`.

3. **Imagem de aplicativo e SO (AMI)**: escolha **Ubuntu Server 22.04 LTS** (64-bit x86). Evite ARM (Graviton) se não souber o motivo — o free tier clássico é x86.

4. **Tipo de instância**: **t2.micro** ou **t3.micro**.

5. **Par de chaves (login)**:
   - Se não tiver: **Criar novo par de chaves** → tipo **RSA** → formato **.pem** → baixe o arquivo e guarde (não perde).

6. **Configurações de rede**:
   - Marque **Permitir tráfego SSH** e escolha **Meu IP** (mais seguro) para a porta **22**.
   - Clique em **Editar** nas regras do grupo de segurança e **adicione**:
     - **HTTP**, porta **80**, origem **0.0.0.0/0** (para o site abrir no navegador).
     - (Opcional agora) **HTTPS**, porta **443**, origem **0.0.0.0/0** — útil depois do domínio.

7. **Armazenamento**: **8 GiB** (ou 20 GiB) gp3 está ok.

8. **Executar instâncias**.

9. Abra a instância na lista e copie o **Endereço IPv4 público** (ex.: `54.123.45.67`). Esse é o `SEU_IP`.

---

## Parte B — Entrar na máquina (SSH)

### No Windows (PowerShell)

1. Coloque o arquivo `sua-chave.pem` numa pasta fácil (ex.: `C:\Users\SeuUsuario\.ssh\`).

2. Abra **PowerShell** e conecte (troque caminho, IP e nome do `.pem`):

```powershell
ssh -i "C:\caminho\para\sua-chave.pem" ubuntu@SEU_IP
```

Na primeira vez, digite `yes` se perguntar sobre fingerprint.

- Se der erro de permissão da chave no Windows, clique com o direito no `.pem` → **Propriedades** → **Segurança** → **Avançado** → desative herança e deixe só seu usuário com leitura.

### No Linux / Mac

```bash
chmod 400 ~/caminho/sua-chave.pem
ssh -i ~/caminho/sua-chave.pem ubuntu@SEU_IP
```

Usuário **`ubuntu`** é o padrão da AMI Ubuntu oficial.

---

## Parte C — Na EC2: instalar Node e ferramentas

Conectado por SSH, rode **na ordem**:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

O `build-essential` e `python3` ajudam o pacote **sqlite3** a compilar no Linux.

---

## Parte D — Colocar o projeto na EC2

### Opção 1 — Git (recomendado)

No GitHub: crie um repositório, suba o código (sem `.env` e sem `node_modules`).

Na EC2:

```bash
cd ~
git clone https://github.com/SEU_USUARIO/SEU_REPO.git cadastro-cleany
cd ~/cadastro-cleany
npm ci --omit=dev
```

Se não existir `package-lock.json`, use:

```bash
npm install --omit=dev
```

### Opção 2 — Copiar pasta do Windows (PowerShell)

No **seu PC** (ajuste caminho da chave, IP e pasta do projeto):

```powershell
scp -i "C:\caminho\sua-chave.pem" -r "c:\Users\joaof\cadastro cleany" ubuntu@SEU_IP:~/cadastro-cleany
```

Na EC2:

```bash
cd ~/cadastro-cleany
npm install --omit=dev
```

---

## Parte E — Arquivo `.env` (senhas de verdade)

Na EC2:

```bash
cd ~/cadastro-cleany
nano .env
```

Cole (altere todos os valores):

```
PORT=3000
SESSION_SECRET=cole-aqui-uma-frase-bem-longa-e-aleatoria
LOGIN_USER=admin
LOGIN_PASSWORD=uma_senha_forte_diferente
```

Salvar no nano: `Ctrl+O`, Enter, `Ctrl+X`.

O programa já carrega esse arquivo com **dotenv**.

---

## Parte F — Pasta do banco SQLite

```bash
mkdir -p ~/cadastro-cleany/data
chmod 755 ~/cadastro-cleany/data
```

---

## Parte G — PM2 (app sempre rodando)

```bash
sudo npm install -g pm2
cd ~/cadastro-cleany
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

O comando `pm2 startup` vai **imprimir uma linha** começando com `sudo env ...`. **Copie e execute essa linha inteira** no terminal (é só uma vez).

Teste:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
```

Deve aparecer **200**.

Comandos úteis depois:

```bash
pm2 logs cadastro-cleany
pm2 restart cadastro-cleany
```

---

## Parte H — Nginx (porta 80 → seu app na 3000)

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/cleany
```

Cole **exatamente**:

```nginx
server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Ativar site e recarregar:

```bash
sudo ln -sf /etc/nginx/sites-available/cleany /etc/nginx/sites-enabled/cleany
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

No navegador: **`http://SEU_IP`** → deve abrir a tela de login.

---

## Parte I — HTTPS com domínio (opcional)

1. No seu provedor de domínio, crie registro **A** apontando para o **IP público** da EC2.

2. Na EC2:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d seu-dominio.com.br
```

Siga as perguntas do Certbot.

---

## Parte J — Depois que estiver no ar

| Faça | Por quê |
|------|--------|
| Backup de `~/cadastro-cleany/data/database.sqlite` | É o banco inteiro |
| Não commitar `.env` | Senhas vazam |
| Conferir **cobrança** em Billing na AWS | Free tier tem limites |

Backup rápido manual:

```bash
cp ~/cadastro-cleany/data/database.sqlite ~/backup-$(date +%F).sqlite
```

---

## Se algo der errado

- **502 Bad Gateway (Nginx)**: app não está na porta 3000 → `pm2 status` e `pm2 logs cadastro-cleany`.
- **Não abre no navegador**: security group sem porta **80** liberada.
- **Erro ao instalar sqlite3**: confirme `build-essential` e `python3` instalados e rode `npm install` de novo na pasta do projeto.

---

## Free tier

Contas novas costumam ter período de **free tier** limitado para **t2/t3.micro**; confira em **Billing → Free Tier** na AWS. Regras e preços mudam — sempre olhe o console oficial.
