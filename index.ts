import { Meeting } from "./Meeting";
import app from "./server";


(async () => {
    const newMeeting = new Meeting(process.env.MEETING_ID!);

    app.post("/meeting/pause",async (req,res) => {
        await newMeeting.pauseRecording();
        res.send("Paused");
    })

    app.post("/meeting/resume",async (req,res) => {
        await newMeeting.resumeRecording();
        res.send("Resume");
    })

    app.listen(3000, async () => {
        console.log("server started");
        await newMeeting.joinMeeting();
        console.log("meeting finished");
        process.exit(0);
    })
})()
