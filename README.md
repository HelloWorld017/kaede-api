# Kaede API
An api server for [Kaede](https://github.com/HelloWorld017/kaede), a neat ghost theme.
This server works as a third-party application of the Ghost Blogging Platform and provides awesome features.

## Features
* Like
  * This server provides `like` function, which is same as 'clap' of medium.

* Comment
  * This server provides simple anonymous comment system.

## Requirements
* Docker, or Nix with flakes enabled.
* Ghost blog and Content API key.

## Docker
You can install this server by Docker.

### Example
`docker-compose.yml`

```yaml
services:
  kaede_api:
    image: 'ghcr.io/helloworld017/kaede-api:latest'
    restart: always
    environment:
      - GHOST_URL=https://blog-api.example.com
      - GHOST_KEY=123456789abcdef0123456789a
      - ADMIN_PASSWORD=your-generated-password-hash
    ports:
      - '11005:11005'
    volumes:
      - database:/data

volumes:
  database:
```

## Environments
| Name               | Description                                                                                  | Default               |
|--------------------|----------------------------------------------------------------------------------------------|-----------------------|
| GHOST_URL          | URL of ghost blog. Required for post requests.                                               |                       |
| GHOST_KEY          | API Key of ghost key. Please refer to the next paragraph                                     |                       |
| CORS_ORIGIN        | **(optional)** Allowed browser origin when the theme and Ghost API use different hosts.      | Origin of GHOST_URL   |
| BACKEND_SQLITE_PATH | **(optional)** Storage directory used by the packaged server.                               | ./data (/data in Docker) |
| COMMENTS_MAX_COUNT | **(optional)** Maximum amount of comments per post. Zero or negative to disable limit.       | 10000                 |
| COMMENTS_MAX_AUTHOR| **(optional)** Maximum length of author name.                                                | 32                    |
| COMMENTS_MAX_CONTENT|**(optional)** Maximum length of content.                                                    | 1500                  |
| ADMIN_PASSWORD     | **(optional)** Site admin password for comments. Please refer to the next paragraph.         |                       |
| PORT               | **(optional)** Port of API Server                                                            | 11005                 |

### Ghost API Key
You'll need a [Ghost API Key](https://ghost.org/docs/content-api/#key) to use this server.
You can get it on `Integrations > Add custom integration > Content API Key` in your Ghost admin page.

### Admin Password
You can delete any comment with this password and you can emphasize your comment by entering this password when you're writing comment.
You can disable Admin Login by set this as empty value.

It **should be hashed** using sha256 + pbkdf2.
You can use `genpassword` in your docker container to generate your password hash, then set it as `ADMIN_PASSWORD`.
```console
$ sudo docker ps
CONTAINER ID        ...   NAMES
0a8e7db176b4        ...   kaede_kaede_api_1

$ sudo docker exec -it kaede_kaede_api_1 genpassword
```

The command also runs with `nix run .#genpassword`, or as `genpassword` inside `nix develop`.

### Max length
When you update `COMMENTS_MAX_AUTHOR` and `COMMENTS_MAX_CONTENT`, you should update
`$KaedeCommentsMaxAuthor` and `$KaedeCommentsMaxContent` options in theme configuration, too.
