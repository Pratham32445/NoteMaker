import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
import { Options } from "selenium-webdriver/chrome";
import { spawn } from "child_process";
import { saveToS3 } from './aws/storeToS3';

export class Meeting {
    meetingId: string;
    driver: WebDriver | null;
    duration: number;
    isStopped: boolean;
    type: "AUDIO" | "VIDEO";
    botName : string;
    static ffmpegProcesses: { [meetingId: string]: any } = {};

    constructor(meetingId: string) {
        this.meetingId = meetingId;
        this.driver = null;
        this.duration = (Number(process.env.DURATION) || 1) * 60 * 1000;
        this.type = (process.env.RECORD_TYPE as "AUDIO" | "VIDEO") || "VIDEO";
        this.isStopped = false;
        this.botName = process.env.NAME || "FATHOM";
    }

    async joinMeeting() {
        try {
            await this.startMeet();
            await this.waitBeforeAdmission();
            const isAdmitted = await this.waitForAdmission();
            if (isAdmitted) {
                if (this.type == "VIDEO") this.monitorPopups();
                this.monitorMeetingLive();
                await this.startRecording();
                await this.meetingTimer();
                await this.stopRecording();
            }
        } catch (error) {
            console.error("Error in joinMeeting:", error);
        }
    }

    async getDriver() {
        const options = new Options();
        options.addArguments(
            "--disable-blink-features=AutomationControlled",
            "--use-fake-ui-for-media-stream",
            "--window-size=1280,720",
            "--auto-select-desktop-capture-source='Entire screen'",
            "--no-sandbox",
            "--disable-popup-blocking",
            "--disable-notifications",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-infobars",
        );

        options.setUserPreferences({
            "profile.default_content_setting_values.notifications": 2,
            "profile.default_content_setting_values.media_stream_mic": 1,
            "profile.default_content_setting_values.media_stream_camera": 1,
            "profile.default_content_setting_values.geolocation": 2,
            "profile.default_content_setting_values.automatic_downloads": 1
        });

        const seleniumUrl = "http://localhost:4444/wd/hub";
        console.log("Connecting to Selenium at:", seleniumUrl);

        return await new Builder()
            .forBrowser(Browser.CHROME)
            .setChromeOptions(options)
            .usingServer(seleniumUrl)
            .build();
    }

    async startRecording() {
        const outputFile = `/app/meet_recording_${this.meetingId}.${this.type == "VIDEO" ? "mp4" : "aac"}`;
        const ffmpegArgs = ["-y"];
        if (this.type === "VIDEO") {
            ffmpegArgs.push(
                "-video_size", "1280x720",
                "-framerate", "30",
                "-f", "x11grab",
                "-i", ":99.0",
            );
        }
        ffmpegArgs.push(
            "-f", "pulse",
            "-i", "default"
        );
        if (this.type === "VIDEO") {
            ffmpegArgs.push(
                "-vf", "crop=1280:720:0:0,format=yuv420p",
                "-c:v", "libx264",
                "-preset", "faster",
                "-tune", "film",
                "-crf", "23",
                "-g", "60",
                "-profile:v", "main",
                "-movflags", "+faststart",
            );
        } else {
            ffmpegArgs.push("-vn");
        }
        ffmpegArgs.push(
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",
            "-ac", "2"
        );
        ffmpegArgs.push(outputFile);
        const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, { stdio: "inherit" });
        Meeting.ffmpegProcesses[this.meetingId] = ffmpegProcess;
    }

    async stopRecording() {
        const process = Meeting.ffmpegProcesses[this.meetingId];
        if (process && !this.isStopped) {
            process.kill("SIGINT");
            await new Promise((resolve) => {
                process.on("close", resolve);
            });
            const extension = this.type == "AUDIO" ? "aac" : "mp4";
            await saveToS3(this.meetingId, extension);
            this.isStopped = true;
            if (this.driver) {
                await this.driver.quit();
                this.driver = null;
            }
            delete Meeting.ffmpegProcesses[this.meetingId];
        }
    }

    async startMeet() {
        const driver = await this.getDriver();
        this.driver = driver;
        await driver.manage().window().maximize();
        await driver.executeScript("window.focus();");
        const meetUrl = `https://meet.google.com/${this.meetingId}`;
        console.log("Opening Meet URL:", meetUrl);
        await driver.get(meetUrl);
        await driver.sleep(1000);

        try {
            const popupButton = await driver.wait(
                until.elementLocated(By.xpath('//span[contains(text(), "Got it")]')), 5000
            );
            await popupButton.click();
        } catch { }

        try {
            const nameInput = await driver.wait(
                until.elementLocated(By.xpath('//input[@placeholder="Your name"]')), 5000
            );
            await nameInput.clear();
            await nameInput.sendKeys(this.botName);
            await driver.sleep(1000);
        } catch { }

        try {
            const joinButton = await driver.wait(
                until.elementLocated(By.xpath('//span[contains(text(), "Ask to join") or contains(text(), "Join now")]')),
                6000
            );
            await joinButton.click();
        } catch { }
    }

    async waitForAdmission() {
        if (!this.driver) return false;
        const timeout = Date.now() + 300000;
        while (Date.now() < timeout) {
            try {
                const hangupButton = await this.driver.findElement(
                    By.css('button[aria-label="Leave call"]')
                );
                if (hangupButton) {
                    console.log("Successfully joined the meeting.");
                    return true;
                }
            } catch {
                console.log("Not yet in the meeting...");
            }
            await new Promise(res => setTimeout(res, 2000));
        }
        return false;
    }
    async isMeetingLive() {
        if (!this.driver) return null;
        try {
            const memberCountElem = await this.driver!.findElement(By.className('uGOf1d'));
            const countText = await memberCountElem.getText();
            return Number(countText);
        } catch (error) {
            console.log(`[${this.meetingId}] Error fetching member count:`, error);
            return null;
        }
    }
    async monitorMeetingLive() {
        while (this.driver && !this.isStopped) {
            if (await this.isRemovedFromMetting()) {
                console.log("\n \n \n bot got removed from the meeting \n \n \n");
                await this.stopRecording();
                break;
            }
            const cnt = await this.isMeetingLive();
            if (cnt != null && cnt == 1) {
                await this.stopRecording(); break;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    async monitorPopups() {
        if (!this.driver) return;
        const popupInterval = setInterval(async () => {
            if (!this.driver || this.isStopped) {
                clearInterval(popupInterval);
                return;
            }
            await this.checkAndClosePopups();
        }, 10000)
    }
    async checkAndClosePopups() {
        const popupTexts = ["Got it", "Dismiss", "OK", "Close", "Understood"];
        for (let text of popupTexts) {
            try {
                const popupButton = await this.driver!.findElement(
                    By.xpath(`//button//span[contains(text(), "${text}")]`)
                );
                if (popupButton) {
                    console.log(`[${this.meetingId}] Dismissing popup: ${text}`);
                    await popupButton.click();
                    await this.driver!.sleep(1000);
                }
            } catch (error) {
                // popup not found
            }
        }
    }
    async isRemovedFromMetting() {
        if (!this.driver) return false;
        try {
            const removedMsg = await this.driver.findElement(
                By.xpath('//*[contains(text(), "You’ve been removed") or contains(text(), "You have been removed")]'));
            if (removedMsg) return true;
        } catch (error) {
            // continue
        }
        try {
            await this.driver.findElement(By.css('button[aria-label="Leave call"]'));
            return false;
        } catch {
            return true;
        }
    }
    async waitBeforeAdmission() {
        return new Promise((resolve) => setTimeout(resolve, 10000));
    }
    async meetingTimer() {
        return new Promise((resolve) => setTimeout(resolve, this.duration))
    }
}   