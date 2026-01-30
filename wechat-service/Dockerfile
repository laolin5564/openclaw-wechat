FROM golang:alpine AS builder

LABEL stage=gobuilder

ENV CGO_ENABLED 0
ENV GOPROXY https://goproxy.cn,direct

RUN apk update --no-cache && apk add --no-cache tzdata

WORKDIR /build

ADD go.mod .
RUN go mod download
COPY . .
RUN go build -ldflags="-s -w" -o /app/main ./main.go


FROM alpine

RUN apk update --no-cache && apk add --no-cache ca-certificates
COPY --from=builder /usr/share/zoneinfo/Asia/Shanghai /usr/share/zoneinfo/Asia/Shanghai
ENV TZ Asia/Shanghai

WORKDIR /app
COPY --from=builder /build/static /app/static
COPY --from=builder /build/assets /app/assets
COPY --from=builder /app/main /app/main

EXPOSE 8848

CMD ["./main"]
