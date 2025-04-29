import { Meeting } from "./Meeting";

const newMeeting = new Meeting(process.env.MEETING_ID!);

newMeeting.joinMeeting();