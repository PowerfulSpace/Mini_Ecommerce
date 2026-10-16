using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using PS.MiniEcommerce.Application.Exceptions;
using PS.MiniEcommerce.Domain.Exceptions;

namespace PS.MiniEcommerce.API.ExceptionHandling;

public class ExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var (statusCode, problem) = MapException(exception, httpContext);

        if (problem is null)
        {
            return false;
        }

        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(problem, cancellationToken);

        return true;
    }

    private static (int StatusCode, ProblemDetails? Problem) MapException(Exception exception, HttpContext context)
    {
        var instance = context.Request.Path;

        return exception switch
        {
            ValidationException validation => (
                StatusCodes.Status400BadRequest,
                new ProblemDetails
                {
                    Type = "https://tools.ietf.org/html/rfc9110#section-15.5.1",
                    Title = "One or more validation errors occurred.",
                    Status = StatusCodes.Status400BadRequest,
                    Detail = "The request body is invalid.",
                    Instance = instance,
                    Extensions =
                    {
                        ["errors"] = validation.Errors,
                        ["code"] = "validation_error"
                    }
                }),

            DomainValidationException domainValidation => (
                StatusCodes.Status400BadRequest,
                new ProblemDetails
                {
                    Type = "https://tools.ietf.org/html/rfc9110#section-15.5.1",
                    Title = "Validation error.",
                    Status = StatusCodes.Status400BadRequest,
                    Detail = domainValidation.Message,
                    Instance = instance,
                    Extensions = { ["code"] = "validation_error" }
                }),

            DomainConflictException domainConflict => (
                StatusCodes.Status409Conflict,
                new ProblemDetails
                {
                    Type = "https://tools.ietf.org/html/rfc9110#section-15.5.10",
                    Title = "Conflict.",
                    Status = StatusCodes.Status409Conflict,
                    Detail = domainConflict.Message,
                    Instance = instance
                }),

            NotFoundException notFound => (
                StatusCodes.Status404NotFound,
                new ProblemDetails
                {
                    Type = "https://tools.ietf.org/html/rfc9110#section-15.5.5",
                    Title = "Resource not found.",
                    Status = StatusCodes.Status404NotFound,
                    Detail = notFound.Message,
                    Instance = instance,
                    Extensions = { ["code"] = "not_found" }
                }),

            _ => (-1, null)
        };
    }
}
