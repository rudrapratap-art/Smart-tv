const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const path=require("path");
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.static(path.join(__dirname,"public")));
app.get("/health",(req,res)=>res.json({ok:true,app:"Smart Classroom"}));
io.on("connection",socket=>{
 socket.on("join-room",room=>{socket.join(room||"CLASS10");socket.emit("joined",room||"CLASS10");});
 socket.on("class-state",payload=>{socket.to(payload.room||"CLASS10").emit("class-state",payload.state);});
});
const port=process.env.PORT||3000;
server.listen(port,"0.0.0.0",()=>console.log(`Smart Classroom running on ${port}`));
