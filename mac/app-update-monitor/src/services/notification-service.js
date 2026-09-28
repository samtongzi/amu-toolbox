class NotificationService {
  constructor({ Notification, onClick = () => {} }) {
    this.Notification = Notification;
    this.onClick = onClick;
  }

  notify({ title, body }) {
    if (!this.Notification?.isSupported?.()) return;
    const notification = new this.Notification({ title, body, silent: false });
    notification.on?.("click", this.onClick);
    notification.show();
  }
}

module.exports = { NotificationService };
