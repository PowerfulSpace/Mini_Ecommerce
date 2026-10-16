using Microsoft.EntityFrameworkCore;
using PS.MiniEcommerce.Application.Abstractions.Persistence;

namespace PS.MiniEcommerce.Infrastructure.Persistence;

public class CheckoutAttemptRepository : ICheckoutAttemptRepository
{
    private readonly AppDbContext _dbContext;

    public CheckoutAttemptRepository(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<CheckoutAttemptData?> GetByUserAndKeyAsync(
        Guid userId,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        var attempt = await _dbContext.CheckoutAttempts
            .AsNoTracking()
            .FirstOrDefaultAsync(
                a => a.UserId == userId && a.IdempotencyKey == idempotencyKey,
                cancellationToken);

        return attempt is null ? null : ToData(attempt);
    }

    public async Task<CheckoutAttemptData> ReserveAsync(
        Guid userId,
        string idempotencyKey,
        byte[] requestFingerprint,
        DateTime utcNow,
        TimeSpan leaseDuration,
        CancellationToken cancellationToken)
    {
        var attempt = CheckoutAttempt.Create(
            userId,
            idempotencyKey,
            requestFingerprint,
            utcNow,
            leaseDuration);

        _dbContext.CheckoutAttempts.Add(attempt);

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            return ToData(attempt);
        }
        catch (DbUpdateException exception) when (IsUniqueConstraintViolation(exception))
        {
            _dbContext.Entry(attempt).State = EntityState.Detached;

            var existing = await GetByUserAndKeyAsync(userId, idempotencyKey, cancellationToken);
            if (existing is null)
            {
                throw;
            }

            return existing;
        }
    }

    private static CheckoutAttemptData ToData(CheckoutAttempt attempt) => new(
        attempt.Id,
        attempt.UserId,
        attempt.IdempotencyKey,
        attempt.RequestFingerprint,
        attempt.Status == CheckoutAttemptStatus.InProgress
            ? CheckoutAttemptState.InProgress
            : CheckoutAttemptState.Completed,
        attempt.OrderId,
        attempt.ResponseStatusCode,
        attempt.ResponsePayload,
        attempt.LeaseExpiresAtUtc);

    private static bool IsUniqueConstraintViolation(DbUpdateException exception)
    {
        return exception.InnerException is Microsoft.Data.SqlClient.SqlException sqlException
            && (sqlException.Number == 2601 || sqlException.Number == 2627);
    }
}
