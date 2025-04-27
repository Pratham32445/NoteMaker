import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver'
import { Options } from "selenium-webdriver/chrome"

export class Meeting {
    meetingId: string;
    driver: WebDriver | null;
    delay = 30000;
    constructor(meetingId: string) {
        this.meetingId = meetingId;
        this.driver = null;
    }
    async joinMeeting() {
        try {
            this.startMeet();
            await new Promise((resolve) => setTimeout(resolve, this.delay));
            this.startRecording();
        } catch (error) {
            console.log(error);
        }
    }
    async getDriver() {
        const options = new Options({});
        options.addArguments(
            "--disable-blink-features=AutomationControlled",
            "--use-fake-ui-for-media-stream",
            "--window-size=1080,720",
            "--auto-select-desktop-capture-source=[RECORD]",
            '--allow-running-insecure-content',
        );
        let driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build()
        return driver;
    }
    async startRecording() {
        if (!this.driver) return;
    }
    async startMeet() {
        const driver = await this.getDriver();
        this.driver = driver;
        await driver.get(`https://meet.google.com/${this.meetingId}`)
        const popupButton = await driver.wait(until.elementLocated(By.xpath('//span[contains(text(), "Got it")]')), 10000);
        await popupButton.click()
        const nameInput = await driver.wait(until.elementLocated(By.xpath('//input[@placeholder="Your name"]')), 10000);
        await nameInput.clear();
        await nameInput.click();
        await nameInput.sendKeys("Fathom");
        await driver.sleep(1000)
        const buttonInput = await driver.wait(until.elementLocated(By.xpath('//span[contains(text(), "Ask to join")]')), 10000);
        buttonInput.click();
    }
}