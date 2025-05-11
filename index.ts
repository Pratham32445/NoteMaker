import { Meeting } from "./Meeting";
import app from "./server";

function startProcess() {       

    const UUID = process.env.UUID;
    const MEETING_ID = process.env.MEETING_ID;
    if (!UUID || !MEETING_ID) {
        console.log("slug and meeting id is a required field");
        process.exit(0);
    }

    const newMeeting = new Meeting(process.env.MEETING_ID!);

    app.post(`/${UUID}/meeting/pause`, async (req, res) => {
        await newMeeting.pauseRecording();
        res.send("Paused");
    })

    app.post(`/${UUID}/meeting/resume`, async (req, res) => {
        await newMeeting.resumeRecording();
        res.send("Resume");
    })

    app.listen(3000, async () => {
        console.log("server started");
        await newMeeting.joinMeeting();
        console.log("meeting finished");
        process.exit(0);
    })
}


startProcess();