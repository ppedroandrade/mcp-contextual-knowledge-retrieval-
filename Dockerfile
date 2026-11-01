# Nexo, o assistente da empresa (ADRs 012 a 015): interface e API em Node 22. O banco e o
# Ollama vêm do docker-compose.yml. As medições do TCC continuam rodando fora do container,
# pelos scripts (ADR 011), e este container não participa delas.
FROM node:22.23.4-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
# O tsx (devDependency) roda o TypeScript sem build. Nenhum pacote precisa de script de
# instalação aqui; o binário do esbuild vem pela dependência opcional da plataforma.
RUN npm ci --ignore-scripts && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY apps ./apps
COPY data ./data

EXPOSE 3100
CMD ["node_modules/.bin/tsx", "src/assistant/server.ts", "--host", "0.0.0.0", "--exemplo"]
