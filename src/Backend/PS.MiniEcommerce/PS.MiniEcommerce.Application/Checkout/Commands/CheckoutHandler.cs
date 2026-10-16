using MediatR;
using PS.MiniEcommerce.Application.Abstractions.CurrentUser;
using PS.MiniEcommerce.Application.Abstractions.Persistence;
using PS.MiniEcommerce.Domain.Exceptions;

namespace PS.MiniEcommerce.Application.Checkout.Commands;

public class CheckoutHandler : IRequestHandler<CheckoutCommand, CheckoutExecutionResult>
{
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromSeconds(30);

    private readonly ICheckoutAttemptRepository _checkoutAttemptRepository;
    private readonly ICheckoutTransactionExecutor _checkoutTransactionExecutor;
    private readonly ICurrentUser _currentUser;

    public CheckoutHandler(
        ICheckoutAttemptRepository checkoutAttemptRepository,
        ICheckoutTransactionExecutor checkoutTransactionExecutor,
        ICurrentUser currentUser)
    {
        _checkoutAttemptRepository = checkoutAttemptRepository;
        _checkoutTransactionExecutor = checkoutTransactionExecutor;
        _currentUser = currentUser;
    }

    public async Task<CheckoutExecutionResult> Handle(
        CheckoutCommand request,
        CancellationToken cancellationToken)
    {
        var userId = _currentUser.UserId;
        var utcNow = DateTime.UtcNow;

        var existing = await _checkoutAttemptRepository.GetByUserAndKeyAsync(
            userId,
            request.IdempotencyKey,
            cancellationToken);

        if (existing is not null)
        {
            return HandleExistingAttempt(existing, request);
        }

        var reserved = await _checkoutAttemptRepository.ReserveAsync(
            userId,
            request.IdempotencyKey,
            request.RequestFingerprint,
            utcNow,
            LeaseDuration,
            cancellationToken);

        if (reserved.State != CheckoutAttemptState.InProgress)
        {
            return HandleExistingAttempt(reserved, request);
        }

        return await _checkoutTransactionExecutor.ExecuteAsync(
            userId,
            reserved.Id,
            request.IfMatch,
            utcNow,
            cancellationToken);
    }

    private static CheckoutExecutionResult HandleExistingAttempt(
        CheckoutAttemptData attempt,
        CheckoutCommand request)
    {
        if (!attempt.RequestFingerprint.SequenceEqual(request.RequestFingerprint))
        {
            throw new DomainConflictException(
                "Idempotency key was reused with a different request.",
                "idempotency_key_reused");
        }

        if (attempt.State == CheckoutAttemptState.Completed)
        {
            return new CheckoutExecutionResult(
                Success: attempt.ResponseStatusCode == 201,
                ResponseStatusCode: attempt.ResponseStatusCode!.Value,
                ResponsePayload: attempt.ResponsePayload!,
                OrderId: null,
                NewCartRowVersion: null);
        }

        throw new DomainConflictException(
            "A checkout attempt with this idempotency key is already in progress.",
            "idempotency_in_progress");
    }
}
