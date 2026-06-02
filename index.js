import express from "express";

const app = express();
const PORT = process.env.PORT ?? 8000;

app.get("/", (req, res) => {
  return res.status(200).json({ status: "Server is up and running" });
});

app.listen(PORT, () => {
  console.log(`Server is running on PORT: ${PORT}`);
});
