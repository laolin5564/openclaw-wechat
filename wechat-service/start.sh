#!/bin/bash
# 微信 iPad 协议服务 - 一键启动脚本 (ARM64 macOS 修复版)

set -e

echo "========================================"
echo "  微信 iPad 协议服务 - 启动脚本"
echo "========================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目目录
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# 1. 清理旧容器（可选）
echo -e "${YELLOW}[1/5] 检查并清理旧容器...${NC}"
docker ps -a --filter "name=my-mysql" --format "{{.Names}}" | grep -q my-mysql && {
    echo -e "${RED}发现已存在的 MySQL 容器，是否删除重新创建？ (y/n)${NC}"
    read -r answer
    if [ "$answer" = "y" ]; then
        docker stop my-mysql my-redis my-go-app 2>/dev/null || true
        docker rm my-mysql my-redis my-go-app 2>/dev/null || true
        echo -e "${GREEN}已删除旧容器${NC}"
    else
        echo -e "${GREEN}使用现有容器${NC}"
    fi
}
echo ""

# 2. 启动 MySQL 8.0（ARM64 原生支持，带 utf8mb4 字符集）
echo -e "${YELLOW}[2/5] 启动 MySQL 8.0 (utf8mb4 字符集, ARM64)...${NC}"
docker ps --filter "name=my-mysql" --format "{{.Names}}" | grep -q my-mysql || {
    docker run -d \
        --name my-mysql \
        -p 3306:3306 \
        -e MYSQL_ROOT_PASSWORD='lln@2022' \
        -e MYSQL_DATABASE='lln-robot2' \
        -v "$PROJECT_DIR/init.sql:/docker-entrypoint-initdb.d/init.sql" \
        mysql:8.0 \
        --character-set-server=utf8mb4 \
        --collation-server=utf8mb4_unicode_ci \
        --default-authentication-plugin=mysql_native_password

    echo -e "${GREEN}MySQL 容器已启动${NC}"
    echo -e "${YELLOW}等待 MySQL 就绪...${NC}"
    sleep 20
}
echo -e "${GREEN}MySQL 运行中${NC}"
echo ""

# 3. 执行字符集初始化
echo -e "${YELLOW}[3/5] 初始化数据库字符集...${NC}"
docker exec my-mysql mysql -uroot -plln@2022 -e "
    ALTER DATABASE \`lln-robot2\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
" 2>/dev/null || echo "数据库可能已存在，继续..."

# 尝试修改表字符集（表可能不存在，忽略错误）
docker exec my-mysql mysql -uroot -plln@2022 \`lln-robot2\` -e "
    ALTER TABLE user_info_entity CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    ALTER TABLE device_info_entity CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    ALTER TABLE license_key CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    ALTER TABLE user_login_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    ALTER TABLE user_business_log CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
" 2>/dev/null && echo -e "${GREEN}表字符集已更新${NC}" || echo -e "${YELLOW}表尚未创建（程序首次运行时会自动创建）${NC}"

# 验证字符集
echo -e "${YELLOW}验证 MySQL 字符集配置:${NC}"
docker exec my-mysql mysql -uroot -plln@2022 -e "SHOW VARIABLES LIKE 'character%';" | grep -E "character_set_database|character_set_server|collation_database|collation_server"
echo ""

# 4. 启动 Redis
echo -e "${YELLOW}[4/5] 启动 Redis...${NC}"
docker ps --filter "name=my-redis" --format "{{.Names}}" | grep -q my-redis || {
    docker run -d \
        --name my-redis \
        -p 6379:6379 \
        redis:6.2 \
        redis-server --requirepass 'lln@2022'

    echo -e "${GREEN}Redis 容器已启动${NC}"
    sleep 3
}
echo -e "${GREEN}Redis 运行中${NC}"
echo ""

# 5. 构建并启动应用
echo -e "${YELLOW}[5/5] 启动应用...${NC}"

# 检查是否已构建镜像
if docker images | grep -q "my-go-app"; then
    echo -e "${GREEN}使用已有镜像${NC}"
else
    echo -e "${YELLOW}构建 Docker 镜像...${NC}"
    docker build -t my-go-app .
fi

# 停止旧应用容器
docker ps --filter "name=my-go-app" --format "{{.Names}}" | grep -q my-go-app && {
    docker stop my-go-app
    docker rm my-go-app
}

# 获取 macOS 的主机地址
HOST_IP="host.docker.internal"

# 启动新容器（使用桥接网络 + 端口映射）
docker run -d \
    --name my-go-app \
    -p 8099:8099 \
    -p 6060:6060 \
    -e DB_HOST="$HOST_IP" \
    -e REDIS_HOST="$HOST_IP" \
    -v "$PROJECT_DIR/log:/app/log" \
    -v "$PROJECT_DIR/data:/app/data" \
    my-go-app

echo ""
echo "========================================"
echo -e "${GREEN}启动完成！${NC}"
echo "========================================"
echo ""
echo "服务地址:"
echo "  - API:     http://localhost:8099"
echo "  - 文档:    http://localhost:8099/docs"
echo ""
echo "管理员密钥: daidai"
echo ""
echo "查看日志:"
echo "  docker logs -f my-go-app"
echo ""
echo "停止服务:"
echo "  ./stop.sh"
echo ""
