using System.Net;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using ShopMint.Api.Infrastructure.Persistence;

namespace ShopMint.Api.Modules.Notifications;

public sealed class EmailOptions
{
    public string FromAddress { get; set; } = "no-reply@shopmint.in";
    public string FromName { get; set; } = "ShopMint";
    public SmtpOptions Smtp { get; set; } = new();
    public DispatcherOptions Dispatcher { get; set; } = new();

    public sealed class SmtpOptions
    {
        /// <summary>Empty disables delivery (mail stays queued). Development uses Mailpit on localhost:1025.</summary>
        public string? Host { get; set; }
        public int Port { get; set; } = 587;
        public string? Username { get; set; }
        /// <summary>Secret: supply via environment variable Email__Smtp__Password, never in appsettings.</summary>
        public string? Password { get; set; }
        /// <summary>None (local Mailpit only), StartTls or SslOnConnect.</summary>
        public string Security { get; set; } = "StartTls";
    }

    public sealed class DispatcherOptions
    {
        public bool Enabled { get; set; } = true;
        public int IntervalSeconds { get; set; } = 5;
        public int BatchSize { get; set; } = 20;
        public int MaxAttempts { get; set; } = 8;
    }
}

public sealed record EmailMessage(string ToAddress, string? ToName, string Subject, string TextBody, string HtmlBody);

public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken ct);
}

public sealed class SmtpEmailSender(Microsoft.Extensions.Options.IOptions<EmailOptions> options) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct)
    {
        var o = options.Value;
        var mime = new MimeMessage();
        mime.From.Add(new MailboxAddress(o.FromName, o.FromAddress));
        mime.To.Add(new MailboxAddress(message.ToName ?? "", message.ToAddress));
        mime.Subject = message.Subject;
        mime.Body = new BodyBuilder { TextBody = message.TextBody, HtmlBody = message.HtmlBody }.ToMessageBody();

        using var client = new SmtpClient();
        var security = Enum.TryParse<SecureSocketOptions>(o.Smtp.Security, ignoreCase: true, out var s) ? s : SecureSocketOptions.StartTls;
        var host = o.Smtp.Host ?? throw new InvalidOperationException("Email:Smtp:Host is not configured.");
        await client.ConnectAsync(host, o.Smtp.Port, security, ct);
        if (!string.IsNullOrEmpty(o.Smtp.Username))
            await client.AuthenticateAsync(o.Smtp.Username, o.Smtp.Password ?? "", ct);
        await client.SendAsync(mime, ct);
        await client.DisconnectAsync(true, ct);
    }
}

/// <summary>
/// Builds transactional emails and adds them to the caller's DbContext, so they commit atomically with the
/// change that caused them. Links are built from the configured public URL, never from the request's Host
/// header (which an attacker could forge to steal reset links). User-supplied text is HTML-encoded.
/// </summary>
public sealed class EmailOutbox(IConfiguration config)
{
    private string PublicUrl => (config["App:PublicUrl"] ?? throw new InvalidOperationException(
        "App:PublicUrl is not configured. It is required to build links in emails.")).TrimEnd('/');

    public string Link(string path) => PublicUrl + path;

    public void PasswordReset(AppDbContext db, User user, string token) => Enqueue(db, null, "password_reset", user.Email, user.Name,
        "Reset your ShopMint password",
        $"Hi {user.Name},",
        "We received a request to reset the password for your ShopMint account. This link works once and expires in 1 hour.",
        "Reset password", Link($"/reset-password?token={Uri.EscapeDataString(token)}"),
        "If you didn't ask for this, you can ignore this email. Your password won't change.");

    public void VerifyEmail(AppDbContext db, User user, string token) => Enqueue(db, null, "verify_email", user.Email, user.Name,
        "Confirm your email address",
        $"Hi {user.Name},",
        "Confirm that this is your email address so we can send you order alerts and account notices. The link expires in 48 hours.",
        "Confirm email", Link($"/verify-email?token={Uri.EscapeDataString(token)}"),
        "If you didn't create a ShopMint account, you can ignore this email.");

    public void Invitation(AppDbContext db, Guid tenantId, string toEmail, string storeName, string inviterName, MemberRole role, string token) =>
        Enqueue(db, tenantId, "staff_invitation", toEmail, null,
            $"{inviterName} invited you to {storeName} on ShopMint",
            "Hello,",
            $"{inviterName} has invited you to help run {storeName} on ShopMint as {Article(role)} {role}. The invitation expires in 7 days.",
            "Accept invitation", Link($"/invite/{Uri.EscapeDataString(token)}"),
            "If you weren't expecting this, you can ignore this email.");

    /// <summary>Shopper reset link on the store's own domain (built from the registered host, never the request).</summary>
    public void CustomerPasswordReset(AppDbContext db, Guid tenantId, string storeName, string storeUrl, Customer customer, string token) =>
        Enqueue(db, tenantId, "customer_password_reset", customer.Email, customer.Name,
            $"Reset your password for {storeName}",
            $"Hi {customer.Name},",
            $"We received a request to reset the password for your {storeName} account. This link works once and expires in 1 hour.",
            "Reset password", $"{storeUrl}/account/reset-password?token={Uri.EscapeDataString(token)}",
            "If you didn't ask for this, you can ignore this email. Your password won't change.");

    public void OrderConfirmed(AppDbContext db, Guid tenantId, string storeName, string storeUrl, Orders.Order o) =>
        Enqueue(db, tenantId, "order_confirmed", o.Email, o.CustomerName,
            $"Order #{o.Number} confirmed at {storeName}",
            $"Hi {o.CustomerName},",
            $"Thanks for your order #{o.Number} ({Items(o)}, total {Orders.Money.Inr(o.Total)}, "
            + (o.PaymentMethod == Orders.PaymentMethod.Cod ? "to be paid on delivery" : "paid") + $"). We'll email you when it ships to {o.ShipCity}.",
            "View your order", $"{storeUrl}/account/orders/{o.Id}",
            $"Questions? Reply to {storeName}'s support address shown on the store.");

    public void NewOrderAlert(AppDbContext db, Guid tenantId, string storeName, string adminUrl, string to, Orders.Order o) =>
        Enqueue(db, tenantId, "order_new_alert", to, null,
            $"New order #{o.Number}: {Orders.Money.Inr(o.Total)}",
            "You have a new order.",
            $"{o.CustomerName} ordered {Items(o)} for {Orders.Money.Inr(o.Total)} ({(o.PaymentMethod == Orders.PaymentMethod.Cod ? "cash on delivery" : "paid online")}), delivering to {o.ShipCity}.",
            "Open the order", adminUrl,
            $"You're receiving this because you run {storeName} on ShopMint.");

    public void OrderShipped(AppDbContext db, Guid tenantId, string storeName, string storeUrl, Orders.Order o, string carrier, string tracking, string? trackingUrl) =>
        Enqueue(db, tenantId, "order_shipped", o.Email, o.CustomerName,
            $"Order #{o.Number} has shipped",
            $"Hi {o.CustomerName},",
            $"Your order #{o.Number} from {storeName} is on its way with {carrier} (tracking number {tracking}).",
            trackingUrl is null ? "View your order" : "Track your parcel", trackingUrl ?? $"{storeUrl}/account/orders/{o.Id}",
            "Delivery times depend on the courier and your PIN code.");

    public void OrderCancelled(AppDbContext db, Guid tenantId, string storeName, string storeUrl, Orders.Order o, bool refunding) =>
        Enqueue(db, tenantId, "order_cancelled", o.Email, o.CustomerName,
            $"Order #{o.Number} was cancelled",
            $"Hi {o.CustomerName},",
            $"Your order #{o.Number} from {storeName} has been cancelled."
            + (refunding ? $" We've started a refund of {Orders.Money.Inr(o.Total - o.RefundedTotal)} to your original payment method; banks usually take 5–7 working days." : ""),
            "View your order", $"{storeUrl}/account/orders/{o.Id}",
            "If you didn't expect this, contact the store.");

    public void ReturnUpdated(AppDbContext db, Guid tenantId, string storeName, string storeUrl, Guid orderId, int number, string to, string name,
        Orders.ReturnStatus status, string? storeNote)
    {
        var (subject, text) = status switch
        {
            Orders.ReturnStatus.Approved => ($"Your return for order #{number} is approved", "Your return has been approved. Please send the items back as the store describes below."),
            Orders.ReturnStatus.Rejected => ($"About your return for order #{number}", "The store couldn't accept this return."),
            Orders.ReturnStatus.Received => ($"We've received your return for order #{number}", "The store has received your returned items."),
            Orders.ReturnStatus.Refunded => ($"Refund issued for your return (order #{number})", "Your refund has been issued to your original payment method (cash on delivery orders are refunded as the store arranges with you). Banks usually take 5–7 working days."),
            Orders.ReturnStatus.Closed => ($"Your return for order #{number} is complete", "Your return is complete."),
            _ => ($"Update on your return for order #{number}", "There's an update on your return."),
        };
        Enqueue(db, tenantId, "return_" + status.ToString().ToLowerInvariant(), to, name, subject, $"Hi {name},",
            text + (string.IsNullOrWhiteSpace(storeNote) ? "" : $" Note from {storeName}: {storeNote}"),
            "View your order", $"{storeUrl}/account/orders/{orderId}", $"Questions? Contact {storeName}.");
    }

    /// <summary>Double opt-in for a store's newsletter; nothing is sent to the address again unless they confirm.</summary>
    public void NewsletterConfirm(AppDbContext db, Guid tenantId, string storeName, string to, string confirmUrl, string unsubscribeUrl) =>
        Enqueue(db, tenantId, "newsletter_confirm", to, null,
            $"Confirm your subscription to {storeName}",
            "Hello,",
            $"Someone (hopefully you) asked to receive {storeName}'s newsletter at this address. Confirm to start receiving it; if you didn't ask, ignore this email and you won't hear from us again.",
            "Confirm subscription", confirmUrl,
            $"You can unsubscribe from {storeName}'s newsletter at any time.", ("Unsubscribe", unsubscribeUrl));

    /// <summary>The gift card code is in the email by design: it's how the recipient receives it. It is not stored in plain text.</summary>
    public void GiftCardIssued(AppDbContext db, Guid tenantId, string storeName, string storeUrl, string to, string? name, string code, decimal value,
        DateTimeOffset? expiresAt, string? message) =>
        Enqueue(db, tenantId, "gift_card_issued", to, name,
            $"Your {Orders.Money.Inr(value)} gift card for {storeName}",
            name is null ? "Hello," : $"Hi {name},",
            $"You have a {storeName} gift card worth {Orders.Money.Inr(value)}. Your code is {code}. Enter it at checkout (it can pay all of an order, or part with the rest paid online)."
            + (expiresAt is { } e ? $" It's valid until {e.ToOffset(TimeSpan.FromHours(5.5)):d MMMM yyyy}." : "")
            + (string.IsNullOrWhiteSpace(message) ? "" : $" Message from the store: {message}"),
            $"Shop {storeName}", storeUrl,
            "Keep this code private: anyone with it can spend the balance.");

    // ----- Store notifications -----

    public void LowStockDigest(AppDbContext db, Guid tenantId, string to, string storeName, string inventoryUrl, IReadOnlyList<(string Title, string Sku, int Available)> items, int more) =>
        Enqueue(db, tenantId, "low_stock_digest", to, null,
            $"{items.Count + more} {(items.Count + more == 1 ? "item is" : "items are")} running low at {storeName}",
            "Hello,",
            "These variants are at or below your low-stock alert level: "
                + string.Join("; ", items.Select(i => $"{i.Title} ({i.Sku}): {(i.Available <= 0 ? "out of stock" : $"{i.Available} left")}"))
                + (more > 0 ? $"; and {more} more." : "."),
            "Review inventory", inventoryUrl,
            "You get this at most once a day, only when the list changes. Turn it off under Your account → Notifications.");

    public void AbandonedCart(AppDbContext db, Guid tenantId, string to, string name, string storeName, string cartUrl, IReadOnlyList<(string Title, int Quantity)> items, string unsubscribeUrl) =>
        Enqueue(db, tenantId, "abandoned_cart", to, name,
            $"You left something in your cart at {storeName}",
            $"Hi {name},",
            "Your cart is saved: " + string.Join(", ", items.Select(i => $"{i.Quantity} × {i.Title}")) + ". Prices and stock are checked again when you open it.",
            "Return to your cart", cartUrl,
            $"You're getting this because you agreed to emails from {storeName}.",
            ("Unsubscribe from these emails", unsubscribeUrl));

    // ----- ShopMint billing (to store owners) -----

    private static string Day(DateTimeOffset d) => d.ToOffset(TimeSpan.FromMinutes(330)).ToString("d MMMM yyyy", System.Globalization.CultureInfo.GetCultureInfo("en-IN"));

    public void TrialEnding(AppDbContext db, Guid tenantId, string to, string storeName, string billingUrl, DateTimeOffset endsAt) =>
        Enqueue(db, tenantId, "billing_trial_ending", to, null,
            $"Your ShopMint trial for {storeName} ends on {Day(endsAt)}",
            "Hello,",
            $"The free trial for {storeName} ends on {Day(endsAt)}. Choose a plan to keep your store open; you won't be charged until the trial ends.",
            "Choose a plan", billingUrl,
            "If you don't choose a plan, your storefront closes when the trial ends. Your data is kept and you can subscribe later.");

    public void PaymentFailed(AppDbContext db, Guid tenantId, string to, string storeName, string billingUrl, DateTimeOffset graceEndsAt) =>
        Enqueue(db, tenantId, "billing_payment_failed", to, null,
            $"Payment for {storeName}'s ShopMint plan didn't go through",
            "Hello,",
            $"We couldn't charge your ShopMint subscription for {storeName}. Razorpay will retry automatically. Your store stays open until {Day(graceEndsAt)}.",
            "Update payment", billingUrl,
            "If payment still fails by then, your storefront closes and the admin becomes read-only until you pay.");

    public void StoreSuspended(AppDbContext db, Guid tenantId, string to, string storeName, string billingUrl, bool trialExpired) =>
        Enqueue(db, tenantId, "billing_suspended", to, null,
            $"{storeName} is closed until a plan is active",
            "Hello,",
            trialExpired
                ? $"The free trial for {storeName} has ended, so the storefront is closed and the admin is read-only."
                : $"We couldn't collect payment for {storeName}'s ShopMint plan, so the storefront is closed and the admin is read-only.",
            "Choose a plan", billingUrl,
            "Your products, orders and customers are kept. Subscribing reopens the store straight away.");

    public void SubscriptionActive(AppDbContext db, Guid tenantId, string to, string storeName, string planName, string billingUrl) =>
        Enqueue(db, tenantId, "billing_active", to, null,
            $"{storeName} is on the ShopMint {planName} plan",
            "Hello,",
            $"Thanks! Your {planName} subscription for {storeName} is active.",
            "View billing", billingUrl,
            "Receipts for each payment appear under Billing in your admin.");

    private static string Items(Orders.Order o)
    {
        var n = o.Lines.Sum(l => l.Quantity);
        return n == 1 ? "1 item" : $"{n} items";
    }

    private static string Article(MemberRole role) => role == MemberRole.Owner ? "an" : "a";

    private static void Enqueue(AppDbContext db, Guid? tenantId, string template, string to, string? toName, string subject,
        string greeting, string body, string action, string url, string footer, (string Text, string Url)? optOut = null)
    {
        static string H(string s) => WebUtility.HtmlEncode(s);
        var text = $"{greeting}\n\n{body}\n\n{action}: {url}\n\n{footer}" + (optOut is { } t ? $"\n\n{t.Text}: {t.Url}" : "") + "\n\n— ShopMint";
        var optOutHtml = optOut is { } o
            ? $"""<p style="margin:16px 0 0;font-size:12px;color:#4b5563"><a href="{H(o.Url)}" style="color:#4b5563">{H(o.Text)}</a></p>"""
            : "";
        var html = $"""
            <!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
            <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px">
            <tr><td style="padding:28px">
            <p style="margin:0 0 20px;font-weight:600;font-size:18px;color:#4f46e5">ShopMint</p>
            <p style="margin:0 0 12px;font-size:15px">{H(greeting)}</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.5">{H(body)}</p>
            <p style="margin:0 0 24px"><a href="{H(url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px">{H(action)}</a></p>
            <p style="margin:0 0 8px;font-size:13px;color:#4b5563">Or paste this link into your browser:<br><span style="word-break:break-all">{H(url)}</span></p>
            <p style="margin:16px 0 0;font-size:13px;color:#4b5563">{H(footer)}</p>
            {optOutHtml}
            </td></tr></table></td></tr></table></body></html>
            """;
        var now = DateTimeOffset.UtcNow;
        db.OutboxEmails.Add(new OutboxEmail
        {
            Id = Guid.CreateVersion7(), TenantId = tenantId, Template = template, ToAddress = to, ToName = toName, Subject = subject,
            TextBody = text, HtmlBody = html, Status = EmailStatus.Pending, NextAttemptAt = now, CreatedAt = now,
        });
    }
}

/// <summary>
/// Delivers queued email. Rows are claimed with <c>FOR UPDATE SKIP LOCKED</c>, so several API instances can run
/// the dispatcher safely. Failures back off exponentially. After the last attempt a row is marked Failed.
/// Bodies (which contain live links) are deleted once a row is Sent or Failed. Logs never include bodies.
/// </summary>
public sealed class EmailDispatcher(IServiceScopeFactory scopes, Microsoft.Extensions.Options.IOptions<EmailOptions> options,
    ILogger<EmailDispatcher> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var o = options.Value;
        if (!o.Dispatcher.Enabled) return;
        if (string.IsNullOrWhiteSpace(o.Smtp.Host))
        {
            log.LogWarning("Email delivery is disabled: Email:Smtp:Host is not configured. Messages stay queued.");
            return;
        }
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(1, o.Dispatcher.IntervalSeconds)));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await DispatchPendingAsync(scope.ServiceProvider.GetRequiredService<PlatformDbContext>(),
                    scope.ServiceProvider.GetRequiredService<IEmailSender>(), o.Dispatcher, log, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Email dispatch cycle failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    /// <summary>Sends one batch. Public so tests and one-off jobs can drive it directly.</summary>
    public static async Task<int> DispatchPendingAsync(PlatformDbContext db, IEmailSender sender, EmailOptions.DispatcherOptions o,
        ILogger log, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var batch = await db.OutboxEmails
            .FromSql($"""
                SELECT * FROM email_outbox WHERE status = 'Pending' AND next_attempt_at <= {now}
                ORDER BY next_attempt_at LIMIT {o.BatchSize} FOR UPDATE SKIP LOCKED
                """)
            .ToListAsync(ct);

        var sent = 0;
        foreach (var m in batch)
        {
            try
            {
                await sender.SendAsync(new EmailMessage(m.ToAddress, m.ToName, m.Subject, m.TextBody ?? "", m.HtmlBody ?? ""), ct);
                m.Status = EmailStatus.Sent;
                m.SentAt = DateTimeOffset.UtcNow;
                m.TextBody = m.HtmlBody = null;
                m.LastError = null;
                sent++;
                log.LogInformation("Email {EmailId} ({Template}) sent", m.Id, m.Template);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                m.Attempts++;
                m.LastError = ex.GetType().Name + ": " + Truncate(ex.Message, 400);
                if (m.Attempts >= o.MaxAttempts)
                {
                    m.Status = EmailStatus.Failed;
                    m.TextBody = m.HtmlBody = null;
                    log.LogError("Email {EmailId} ({Template}) failed permanently after {Attempts} attempts: {Error}", m.Id, m.Template, m.Attempts, m.LastError);
                }
                else
                {
                    m.NextAttemptAt = DateTimeOffset.UtcNow.AddSeconds(Math.Min(3600, 15 * Math.Pow(2, m.Attempts - 1)));
                    log.LogWarning("Email {EmailId} ({Template}) attempt {Attempts} failed: {Error}", m.Id, m.Template, m.Attempts, m.LastError);
                }
            }
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return sent;
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
