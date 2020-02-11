# Kaede API
An api server for [Kaede](https://github.com/HelloWorld017/kaede), a neat ghost theme.  
This server works as a third-party application of the Ghost Blogging Platform and provides awesome features.

## Features
* Like
  * This server provides `like` function, which is same as 'clap' of medium.

* Comment
  * This server provides simple anonymous comment system.

## Requirements
* Node.js >= 10  
* MongoDB

## Docker
You can install this server by Docker.

### Example
`docker-compose.yml`

```yaml
version: '3'
services:
  kaede_api:
    image: 'khinenw/kaede-api:1.0.1'
    restart: always
    environment:
      - GHOST_URL=https://blog-api.example.com
      - GHOST_KEY=123456789abcdef0123456789a
      - ADMIN_PASSWORD=admin-kaede-password-here
      - MONGODB_HOST=db
      - MONGODB_USERNAME=root-username-here
      - MONGODB_PASSWORD=root-password-here
    depends_on:
      - database
    ports:
      - '11005:11005'
    networks:
      - kaede

  database:
    image: mongo
    restart: always
    environment:
      - MONGO_INITDB_ROOT_USERNAME=root-username-here
      - MONGO_INITDB_ROOT_PASSWORD=root-password-here
    volumes:
      - database:/data/db
    networks:
      kaede:
        aliases:
          - db

volumes:
  database:

networks:
  kaede:
```

## Environments
| Name               | Description                                                                                  | Default               |
|--------------------|----------------------------------------------------------------------------------------------|-----------------------|
| GHOST_URL          | URL of ghost blog.                                                                           | http://localhost:2368 |
| GHOST_KEY          | API Key of ghost key. Please refer to the next paragraph                                     |                       |
| MONGODB_HOST       | **(optional)** Address of MongoDB                                                            | localhost             |
| MONGODB_PORT       | **(optional)** Port of MongoDB.                                                              | 27017                 |
| MONGODB_DBNAME     | **(optional)** Database name of MongoDB. Default is `ghost-kaede`                            | ghost-kaede           |
| MONGODB_USERNAME   | **(optional)** Username of MongoDB. Empty for disable Authentication.                        |                       |
| MONGODB_PASSWORD   | **(optional)** Password of MongoDB.                                                          |                       |
| COMMENTS_MAX_COUNT | **(optional)** Maximum amount of comments per post. Negative for disable limit.              | 10000                 |
| COMMENTS_MAX_AUTHOR| **(optional)** Maximum length of author name.                                                | 32                    |
| COMMENTS_MAX_CONTENT|**(optional)** Maximum length of content.                                                    | 1500                  |
| ADMIN_PASSWORD     | **(optional)** Site admin password for comments. Please refer to the next paragraph.         |                       |
| PORT               | **(optional)** Port of API Server                                                            | 11005                 |

### Ghost API Key
You'll need a [Ghost API Key](https://ghost.org/docs/api/v3/content/#key) to use this server.  
You can get it on `Integrations > Add custom integraion > Content API Key` in your Ghost admin page.

### Admin Password
You can delete any comment with this password and you can emphasize your comment by entering this password when you're writing comment.  
You can disable Admin Login by set this as empty value.

It **should be hashed** using sha256 + pbkdf2.  
You can use `node /usr/src/app/genpassword` in your docker container to generate your password.
```console
$ sudo docker ps
CONTAINER ID        ...   NAMES
0a8e7db176b4        ...   kaede_kaede_api_1

$ sudo docker exec -it kaede_kaede_api_1 node /usr/src/app/genpassword
```

### Max length
When you update `COMMENT_MAX_AUTHOR` and `COMMENT_MAX_CONTENT`, you should update
`$KaedeCommentsMaxAuthor` and `$KaedeCommentsMaxContent` options in theme configuration, too.
