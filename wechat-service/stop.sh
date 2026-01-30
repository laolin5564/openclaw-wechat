#!/bin/bash
# 停止所有服务

echo "停止服务..."
docker stop my-go-app my-mysql my-redis 2>/dev/null || true
docker rm my-go-app my-mysql my-redis 2>/dev/null || true
echo "服务已停止"
