FROM node:13-alpine

WORKDIR /usr/src/app
COPY package*.json ./

RUN npm install
COPY . .

EXPOSE 11005
ENTRYPOINT ["npm", "start"]
