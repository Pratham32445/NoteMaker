import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import fsRead from "fs";
import fs from "fs/promises"

const client = new S3Client({
    region: "ap-south-1",
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID!,
        secretAccessKey: process.env.SECRET_ACCESS_KEY!
    }
})

export async function saveToS3(videoId: string) {
    const filePath = path.join("/app", `meet_recording_${videoId}.mp4`)
    const bucketName = process.env.BUCKET_NAME;
    try {
        const fileBuffer = await fs.readFile(filePath);
        const date = new Date();
        const fullDate = `${date.getDate()}-${date.getMonth()}-${date.getFullYear()}-${String(Date.now())}`
        const cmd = new PutObjectCommand({
            Bucket: bucketName,
            Key: `recordings/${videoId}-${fullDate}`,
            Body: fileBuffer,
            ContentType: "video/mp4"
        })
        await client.send(cmd);
    } catch (error) {
        console.log("some error occured", error);
    }
}